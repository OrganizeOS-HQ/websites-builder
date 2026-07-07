import type { TrpcInterfaceClient } from "@webstudio-is/trpc-interface/index.server";

/**
 * OrganizeOS publisher (Websites 2.0 Phase 5, slice 4).
 *
 * Implements the deployment publish seam: when an org admin clicks Publish,
 * domain.publish calls deploymentTrpc.publish.mutate. Instead of webstudio's
 * cloud publisher, this dispatches our publish-site GitHub Actions workflow
 * (the executor: CLI sync + build + deploy + pointer-flip callback).
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
  if (build.error || typeof projectId !== "string") return null;

  const project = await client
    .from("Project")
    .select("userId")
    .eq("id", projectId)
    .single();
  const userId = (project.data as { userId?: string | null } | null)?.userId;
  if (project.error || typeof userId !== "string") return null;

  const user = await client
    .from("User")
    .select("email")
    .eq("id", userId)
    .single();
  const email = (user.data as { email?: string } | null)?.email;
  if (user.error || typeof email !== "string") return null;

  return parseOrganizationIdFromServiceEmail(email);
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
      mutate: async (input: { buildId: string }) => {
        const organizationId = await resolveOrganizationIdForBuild(
          deps.client,
          input.buildId
        );
        if (organizationId === null) {
          return {
            success: false as const,
            error: "This project cannot be published.",
          };
        }

        const response = await fetcher(
          `https://api.github.com/repos/${deps.repo}/actions/workflows/publish-site.yml/dispatches`,
          {
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
          }
        );

        if (response.status !== 204) {
          console.error(
            "[organizeos-publisher] dispatch failed",
            response.status,
            await response.text().catch(() => "")
          );
          return {
            success: false as const,
            error: "Publishing could not be started. Please try again.",
          };
        }

        return { success: true as const };
      },
    },
    unpublish: {
      mutate: async () => {
        return {
          success: false as const,
          error: "Unpublishing is managed from your organization settings.",
        };
      },
    },
  };

  return publisher as unknown as TrpcInterfaceClient["deployment"];
};
