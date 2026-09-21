import type { TrpcInterfaceClient } from "@webstudio-is/trpc-interface/index.server";
import { platformName } from "~/shared/branding";
import {
  markBuildPublishStatus,
  type BuildStatusClient,
} from "~/shared/db/publish-status.server";

/**
 * OrganizeOS publisher (Websites 2.0 Phase 5, slice 4).
 *
 * Implements the deployment publish seam: when an org admin clicks Publish,
 * domain.publish calls deploymentTrpc.publish.mutate. Instead of webstudio's
 * cloud publisher, this dispatches our publish-site GitHub Actions workflow
 * (the executor: CLI sync + build + deploy + pointer-flip callback), which
 * reports the outcome back through the internal publish-status route.
 *
 * The workflow needs the ORGANIZATION id. The builder does not store it
 * directly, but every org project is owned by its synthetic service account,
 * whose email encodes it: org+<organizationId>@svc.organizeos.internal (see
 * provision.server.ts deriveSyntheticEmail). We resolve build -> project ->
 * owner email -> organizationId, which also acts as a gate: a project NOT
 * owned by a service account (a human's own project) has no org and cannot
 * dispatch the executor.
 */

const SERVICE_EMAIL_PATTERN = /^org\+(.+)@svc\.organizeos\.internal$/;

/** The executor workflow, which must exist on the publish repo's default branch. */
const WORKFLOW_FILE = "publish-site.yml";

/** Extract the organizationId from a synthetic service-owner email, or null. */
export const parseOrganizationIdFromServiceEmail = (
  email: string
): string | null => {
  const match = SERVICE_EMAIL_PATTERN.exec(email);
  return match === null ? null : match[1];
};

type PostgrestLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        single: () => Promise<{ data: unknown; error: unknown }>;
      };
    };
    update: ReturnType<BuildStatusClient["from"]>["update"];
  };
};

export type OrganizeosPublisherDeps = {
  client: PostgrestLike;
  /** e.g. "OrganizeOS-HQ/websites-builder" */
  repo: string;
  /** Fine-grained token with actions:write on that repo. Server-only. */
  githubToken: string;
  fetcher?: typeof fetch;
};

/**
 * Resolve the org id for a build via its project's synthetic owner email.
 * Returns null when any hop is missing or the owner is not a service account.
 */
export const resolveOrganizationIdForBuild = async (
  client: PostgrestLike,
  buildId: string
): Promise<string | null> => {
  const build = await client
    .from("Build")
    .select("projectId")
    .eq("id", buildId)
    .single();
  const projectId = (build.data as { projectId?: string } | null)?.projectId;
  if (build.error || typeof projectId !== "string") {
    return null;
  }

  const project = await client
    .from("Project")
    .select("userId")
    .eq("id", projectId)
    .single();
  const userId = (project.data as { userId?: string | null } | null)?.userId;
  if (project.error || typeof userId !== "string") {
    return null;
  }

  const user = await client
    .from("User")
    .select("email")
    .eq("id", userId)
    .single();
  const email = (user.data as { email?: string } | null)?.email;
  if (user.error || typeof email !== "string") {
    return null;
  }

  return parseOrganizationIdFromServiceEmail(email);
};

const RETRY_MESSAGE = "Publishing could not be started. Please try again.";
const SETUP_MESSAGE = `Publishing is not set up correctly for this site. Please contact ${platformName} support.`;

/**
 * Which failure the admin is looking at.
 *
 * A dispatch rejected for credentials, a missing repo or workflow, or a
 * payload the workflow will not accept fails identically on the next click —
 * telling the admin to "try again" wastes their time and hides a
 * configuration problem nobody is watching for. A 5xx or a dropped connection
 * genuinely may succeed on a retry.
 *
 * The distinction is the only thing that reaches the UI: the status code and
 * the provider stay in the server log, never in product copy.
 */
const isSetupFailure = (status: number) =>
  status === 401 || status === 403 || status === 404 || status === 422;

/**
 * A publish that never reached the executor would otherwise sit PENDING until
 * the UI's timeout; mark it FAILED now so the admin sees the outcome at once.
 * Best-effort: the user-facing error is already decided.
 */
const markFailed = async (client: PostgrestLike, buildId: string) => {
  try {
    await markBuildPublishStatus(client, { buildId, status: "FAILED" });
  } catch (error) {
    console.error("[organizeos-publisher] could not mark build failed", error);
  }
};

/**
 * A deploymentTrpc drop-in whose publish dispatches the executor workflow.
 * Errors return generic copy (surfaced in the builder UI).
 */
export const createOrganizeosPublisher = (
  deps: OrganizeosPublisherDeps
): TrpcInterfaceClient["deployment"] => {
  const fetcher = deps.fetcher ?? fetch;

  const publisher = {
    publish: {
      mutate: async (input: {
        buildId: string;
        destination?: "saas" | "static";
      }) => {
        // The executor deploys the org's live site; a static export build
        // must never be dispatched as one. Export is hidden for org projects,
        // this is the server-side guarantee.
        if (input.destination === "static") {
          await markFailed(deps.client, input.buildId);
          return {
            success: false as const,
            error: "Static export is not available for OrganizeOS sites.",
          };
        }

        const organizationId = await resolveOrganizationIdForBuild(
          deps.client,
          input.buildId
        );
        if (organizationId === null) {
          await markFailed(deps.client, input.buildId);
          return {
            success: false as const,
            error: "This project cannot be published.",
          };
        }

        const workflowUrl = `https://api.github.com/repos/${deps.repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`;

        let response: Response;
        try {
          response = await fetcher(workflowUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${deps.githubToken}`,
              Accept: "application/vnd.github+json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ref: "main",
              inputs: {
                build_id: input.buildId,
                organization_id: organizationId,
              },
            }),
          });
        } catch (error) {
          // The request never completed. Without this the build would sit
          // PENDING until the dialog's timeout, reporting nothing.
          console.error(
            `[organizeos-publisher] dispatch request failed for ${deps.repo}/${WORKFLOW_FILE}`,
            error
          );
          await markFailed(deps.client, input.buildId);
          return { success: false as const, error: RETRY_MESSAGE };
        }

        if (response.status !== 204) {
          // Name the repo and workflow: a mis-set ORGANIZEOS_PUBLISH_REPO is
          // otherwise indistinguishable from a bad token, and both look like
          // the same generic failure to the admin.
          console.error(
            `[organizeos-publisher] dispatch rejected for ${deps.repo}/${WORKFLOW_FILE}`,
            response.status,
            await response.text().catch(() => "")
          );
          await markFailed(deps.client, input.buildId);
          return {
            success: false as const,
            error: isSetupFailure(response.status)
              ? SETUP_MESSAGE
              : RETRY_MESSAGE,
          };
        }

        return { success: true as const };
      },
    },
    unpublish: {
      mutate: async () => {
        return {
          success: false as const,
          error: `To unpublish, use "Switch back to Website Lite" on your site's Website page in ${platformName}.`,
        };
      },
    },
  };

  return publisher as unknown as TrpcInterfaceClient["deployment"];
};
