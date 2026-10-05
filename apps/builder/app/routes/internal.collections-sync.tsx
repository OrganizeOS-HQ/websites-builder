import { json, type ActionFunctionArgs } from "@remix-run/server-runtime";
import { z } from "zod";
import { createClient } from "@webstudio-is/postgrest/index.server";
import type { AppContext } from "@webstudio-is/trpc-interface/index.server";
import env from "~/env/env.server";
import { isAuthorizedInternalCall } from "~/services/internal-auth.server";
import { syncOrgCollectionPresets } from "~/shared/db/collections-sync.server";
import { COLLECTION_SLUG_RE } from "~/shared/db/resource-presets.server";

// Like provisioning, this acts as the system: it needs only a Postgres client,
// not the request-auth context.
const createSyncContext = (): AppContext =>
  ({
    postgrest: {
      client: createClient(env.POSTGREST_URL, env.POSTGREST_API_KEY),
    },
  }) as AppContext;

// One entry per PUBLIC collection of the org. The builder only reads slug,
// name and kind; the rest is validated loosely and ignored, and unknown keys
// are stripped, so OrganizeOS can add keys without a builder deploy.
const collectionInput = z.object({
  id: z.string().optional(),
  slug: z.string().regex(COLLECTION_SLUG_RE),
  name: z.string().min(1).max(200),
  singularName: z.string().optional(),
  kind: z.string().optional(),
  contentUrl: z.string().optional(),
  fields: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        kind: z.string(),
      })
    )
    .optional(),
});

// organizationId ONLY, like provisioning: the project is derived from it, never
// supplied. `collections` is a full snapshot, not a delta.
const collectionsSyncInput = z.object({
  organizationId: z.string().min(1),
  collections: z.array(collectionInput).max(500),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  // Same guard as /internal/provision: the provision token, and never a cookie.
  if (
    isAuthorizedInternalCall(request, env.ORGANIZEOS_PROVISION_TOKEN) === false
  ) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = collectionsSyncInput.safeParse(body);
  if (parsed.success === false) {
    return json({ error: "Invalid collections sync request" }, { status: 400 });
  }

  const result = await syncOrgCollectionPresets(
    createSyncContext(),
    parsed.data
  );

  switch (result.status) {
    case "no-project":
      return json({ error: "no project for organization" }, { status: 422 });
    // The provision that seeds the static presets has not run (or ran without
    // a token). Nothing to copy the API base and token from.
    case "no-presets":
      return json({ error: "project has no data presets" }, { status: 409 });
    // OrganizeOS retries 5xx.
    case "conflict":
      return json(
        { error: "build changed during sync; retry" },
        { status: 503 }
      );
    case "ok":
      return json({ ok: true, collections: result.collections });
  }
};
