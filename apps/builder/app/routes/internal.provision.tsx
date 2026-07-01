import { json, type ActionFunctionArgs } from "@remix-run/server-runtime";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createClient } from "@webstudio-is/postgrest/index.server";
import type { AppContext } from "@webstudio-is/trpc-interface/index.server";
import env from "~/env/env.server";
import {
  provisionOrgWorkspace,
  deprovisionOrgWorkspace,
} from "~/shared/db/provision.server";

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

const constantTimeEqual = (a: string, b: string): boolean => {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  // timingSafeEqual requires equal-length buffers; the length itself is not
  // secret, so compare lengths first then constant-time compare the bytes.
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
};

/**
 * Server-to-server only. Requires the dedicated ORGANIZEOS_PROVISION_TOKEN
 * (constant-time compared, distinct from TRPC_SERVER_API_TOKEN so it cannot
 * reach the collab-relay/service paths) and rejects any request carrying a
 * session cookie, so a browser or CSRF context can never invoke provisioning.
 */
const isAuthorizedInternalCall = (request: Request): boolean => {
  const token = env.ORGANIZEOS_PROVISION_TOKEN;
  if (token === undefined || token.length === 0) {
    return false;
  }
  if (request.headers.get("Cookie") !== null) {
    return false;
  }
  const header = request.headers.get("Authorization");
  if (header === null) {
    return false;
  }
  return constantTimeEqual(header, token);
};

// organizationId ONLY (+ a display name, the org's admin user ids, and the
// action). No projectId/workspaceId is ever accepted from the caller: every id
// is derived server-side from organizationId, so a caller holding the token
// cannot target another org's project. adminUserIds are the org's active
// admins as resolved by the OrganizeOS ledger (not asserted by an untrusted
// client). Provisioning is idempotent, so "provision" doubles as re-sync.
const provisionInput = z.object({
  action: z.literal("provision").default("provision"),
  organizationId: z.string().min(1),
  orgName: z.string().min(1),
  adminUserIds: z.array(z.string()).default([]),
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
  if (isAuthorizedInternalCall(request) === false) {
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
    adminUserIds: parsed.data.adminUserIds,
  });
  return json(result);
};
