import { json, type ActionFunctionArgs } from "@remix-run/server-runtime";
import { z } from "zod";
import { createClient } from "@webstudio-is/postgrest/index.server";
import type { AppContext } from "@webstudio-is/trpc-interface/index.server";
import env from "~/env/env.server";
import { isAuthorizedInternalCall } from "~/services/internal-auth.server";
import {
  provisionOrgWorkspace,
  deprovisionOrgWorkspace,
} from "~/shared/db/provision.server";
import { defaultOrgEntitlements } from "~/shared/db/organizeos-plan.server";
import { orgSubdomainSchema } from "~/shared/db/organizeos-site.server";

// The internal provisioning route acts as the system (direct inserts as the
// synthetic owner), so it needs only a Postgres client, not the request-auth
// context. Building the client directly also keeps the auth strategy chain out
// of this route's module graph.
const createProvisionContext = (): AppContext =>
  ({
    postgrest: {
      client: createClient(env.POSTGREST_URL, env.POSTGREST_API_KEY),
    },
  }) as AppContext;

// organizationId ONLY (+ a display name, the org's admin emails, and the
// action). No projectId/workspaceId is ever accepted from the caller: every id
// is derived server-side from organizationId, so a caller holding the token
// cannot target another org's project. adminEmails are the org's active admins
// as resolved by the OrganizeOS ledger (not asserted by an untrusted client);
// each is resolved to (or provisioned as) a Webstudio User server-side.
// Provisioning is idempotent, so "provision" doubles as re-sync.
const provisionInput = z.object({
  action: z.literal("provision").default("provision"),
  organizationId: z.string().min(1),
  orgName: z.string().min(1),
  adminEmails: z.array(z.string().email()).default([]),
  // Optional /v1 data-binding seed: the org's read token + API base URL. When
  // both are present the project is seeded with the OrganizeOS Resource presets
  // (Phase 4d). Omitted -> the workspace is provisioned without presets.
  readToken: z.string().min(1).optional(),
  apiBaseUrl: z.string().url().optional(),
  // The org's platform subdomain (<subdomain>.organizeos.org). Mirrored into
  // Project.domain so, with PUBLISHER_HOST set to the platform base domain,
  // every place the builder shows "the site's address" shows the real one.
  // Optional: an older caller leaves the derived org-<id> placeholder.
  subdomain: orgSubdomainSchema.optional(),
  // The org's paid capabilities, as resolved by OrganizeOS (the only authority
  // on what an org is entitled to). Absent -> no paid capability: an older
  // caller, or one that cannot resolve entitlements, must never grant one.
  entitlements: z
    .object({ collections: z.boolean() })
    .default(defaultOrgEntitlements),
});

const deprovisionInput = z.object({
  action: z.literal("deprovision"),
  organizationId: z.string().min(1),
});

const requestInput = z.discriminatedUnion("action", [
  provisionInput,
  deprovisionInput,
]);

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  // Server-to-server only. Requires the dedicated ORGANIZEOS_PROVISION_TOKEN
  // (constant-time compared, distinct from TRPC_SERVER_API_TOKEN so it cannot
  // reach the collab-relay/service paths) and rejects any request carrying a
  // session cookie, so a browser or CSRF context can never invoke provisioning.
  if (
    isAuthorizedInternalCall(request, env.ORGANIZEOS_PROVISION_TOKEN) === false
  ) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (body == null || typeof body !== "object") {
    return json({ error: "Invalid provisioning request" }, { status: 400 });
  }
  // Default a bare body (no action) to provision for ergonomics.
  const withAction =
    "action" in body
      ? body
      : { ...(body as Record<string, unknown>), action: "provision" };
  const parsed = requestInput.safeParse(withAction);
  if (parsed.success === false) {
    return json({ error: "Invalid provisioning request" }, { status: 400 });
  }

  const context = createProvisionContext();

  if (parsed.data.action === "deprovision") {
    await deprovisionOrgWorkspace(context, {
      organizationId: parsed.data.organizationId,
    });
    return json({ ok: true, organizationId: parsed.data.organizationId });
  }

  const result = await provisionOrgWorkspace(context, {
    organizationId: parsed.data.organizationId,
    orgName: parsed.data.orgName,
    adminEmails: parsed.data.adminEmails,
    entitlements: parsed.data.entitlements,
    subdomain: parsed.data.subdomain,
    siteData:
      parsed.data.readToken !== undefined &&
      parsed.data.apiBaseUrl !== undefined
        ? {
            readToken: parsed.data.readToken,
            apiBaseUrl: parsed.data.apiBaseUrl,
          }
        : undefined,
  });
  return json(result);
};
