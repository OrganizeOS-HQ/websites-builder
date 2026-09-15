import { json, type ActionFunctionArgs } from "@remix-run/server-runtime";
import { z } from "zod";
import { createClient } from "@webstudio-is/postgrest/index.server";
import env from "~/env/env.server";
import { isAuthorizedInternalCall } from "~/services/internal-auth.server";
import {
  buildPublishStatuses,
  markBuildPublishStatus,
  type BuildStatusClient,
} from "~/shared/db/publish-status.server";

/**
 * Publish executor write-back (Websites 2.0 Phase 5).
 *
 * The publish-site workflow POSTs here once a build is live (after the
 * OrganizeOS pointer flip) or when the run fails, so the builder's own publish
 * status stops reading "pending" forever. Server-to-server only: authenticated
 * with the builder's service token (the same secret the workflow already uses
 * to sync the build), constant-time compared, and never with a cookie.
 *
 * Marking a build carries no other authority: the site goes live through the
 * OrganizeOS callback, which has its own secret, so a caller holding this
 * token can only change what the builder UI says about a build.
 */
const input = z.object({
  buildId: z.string().min(1),
  status: z.enum(buildPublishStatuses),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  if (isAuthorizedInternalCall(request, env.TRPC_SERVER_API_TOKEN) === false) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = input.safeParse(body);
  if (parsed.success === false) {
    return json({ error: "Invalid publish status request" }, { status: 400 });
  }

  // Narrow-cast: the helper uses a minimal update/eq/not/select slice of the
  // client, typed structurally on its side.
  const client = createClient(
    env.POSTGREST_URL,
    env.POSTGREST_API_KEY
  ) as unknown as BuildStatusClient;

  const updated = await markBuildPublishStatus(client, parsed.data);
  if (updated === false) {
    return json({ error: "Build not found" }, { status: 404 });
  }
  return json({ ok: true, ...parsed.data });
};
