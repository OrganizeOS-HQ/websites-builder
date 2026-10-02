import type { DataSource, Resource } from "@webstudio-is/sdk";
import type { AppContext } from "@webstudio-is/trpc-interface/index.server";
import { getResourcePresetIds } from "../organizeos-preset-ids";

/**
 * OrganizeOS Websites 2.0 Phase 4d: seed a provisioned org's project with
 * ready-to-bind data Resources pointed at the OrganizeOS public read API (/v1).
 *
 * Each preset is a server-side `Resource` (GET) plus a `resource` DataSource so
 * it shows up in the builder's data panel and can be bound to a Collection with
 * no setup. The per-org read token is inlined as a literal Authorization header
 * expression on each Resource; resource headers are evaluated only in the
 * SERVER-side getResources() (builder loader / published-page loader) and never
 * shipped to a visitor's browser (Webstudio resolves Resource fetches in the
 * page loader).
 *
 * The token is an org-scoped, READ-ONLY, public-data-only key (it only unlocks
 * already-published + public data via /v1 and is revocable), so persisting it
 * in the org's own project build is acceptable: the same admins could mint one
 * themselves.
 *
 * All ids are derived DETERMINISTICALLY from (projectId, key) so seeding is
 * idempotent: re-provisioning updates the same Resource/variable in place
 * (e.g. rotating the token value) instead of duplicating presets. The
 * derivation lives in shared/organizeos-preset-ids.ts, because the builder's
 * OrganizeOS panel derives the same ids in the browser: it adds the Forms
 * preset to a project provisioned before Forms existed, and a re-provision
 * then rewrites that same preset.
 */

/**
 * The /v1 read endpoints exposed as data-binding presets. These are the frozen
 * public GET DTOs from Phase 1 (see the OrganizeOS ledger repo). Write surfaces
 * (donate/signup form submission) are a separate mechanism and not seeded here.
 * Forms is the org's published forms, which the OrganizeOS Signup Form block
 * reads through its `data` prop.
 */
export const V1_RESOURCE_PRESETS = [
  { key: "events", label: "Events", path: "/events" },
  { key: "fundraisers", label: "Fundraisers", path: "/fundraisers" },
  { key: "stats", label: "Stats", path: "/stats" },
  { key: "forms", label: "Forms", path: "/forms" },
] as const;

export type OrgResourcePresets = {
  dataSources: DataSource[];
  resources: Resource[];
};

/**
 * Build the preset Resources + DataSources for an org's project. Pure: returns
 * the objects to merge into a build, touches no I/O (async only because the id
 * derivation is).
 */
export const buildOrgResourcePresets = async ({
  projectId,
  apiBaseUrl,
  readToken,
}: {
  projectId: string;
  apiBaseUrl: string;
  readToken: string;
}): Promise<OrgResourcePresets> => {
  const base = apiBaseUrl.replace(/\/+$/, "");

  // The token is inlined as a LITERAL header expression, not routed through a
  // variable DataSource. Variables are instance-scoped (page codegen drops
  // out-of-scope ones: the publish spike produced "Bearer " + undefined), and
  // these Resources must be bindable from any page. Resource headers are only
  // evaluated server-side (builder loader / published-page loader), so the
  // literal is equivalent security-wise, and the deterministic resource ids
  // mean a re-provision rewrites the literal on token rotation.
  const authHeaderExpression = JSON.stringify(`Bearer ${readToken}`);

  const resources: Resource[] = [];
  const dataSources: DataSource[] = [];

  for (const preset of V1_RESOURCE_PRESETS) {
    const { resourceId, bindingId } = await getResourcePresetIds(
      projectId,
      preset.key
    );

    resources.push({
      id: resourceId,
      name: preset.label,
      method: "get",
      // Expressions: a plain URL literal is a quoted string.
      url: JSON.stringify(`${base}${preset.path}`),
      headers: [{ name: "Authorization", value: authHeaderExpression }],
    });

    dataSources.push({
      type: "resource",
      id: bindingId,
      name: preset.label,
      resourceId,
    });
  }

  return { dataSources, resources };
};

/** Replace any existing entries sharing an incoming id, keep the rest, append the incoming. */
const mergeById = <Type extends { id: string }>(
  existing: Type[],
  incoming: Type[]
): Type[] => {
  const incomingIds = new Set(incoming.map((item) => item.id));
  return [...existing.filter((item) => !incomingIds.has(item.id)), ...incoming];
};

/**
 * Seed (or re-sync) the org's dev build with the /v1 Resource presets. Loads the
 * project's dev build (the one with no deployment), merges the presets by their
 * deterministic ids, and writes back. Idempotent: safe to run on every
 * provision. Does nothing observable beyond the presets already present.
 */
export const seedProjectResourcePresets = async (
  context: AppContext,
  {
    projectId,
    apiBaseUrl,
    readToken,
  }: { projectId: string; apiBaseUrl: string; readToken: string }
): Promise<void> => {
  const client = context.postgrest.client;

  const build = await client
    .from("Build")
    .select("id, dataSources, resources")
    .eq("projectId", projectId)
    .is("deployment", null)
    .single();
  if (build.error) {
    throw build.error;
  }

  const existingDataSources = JSON.parse(
    build.data.dataSources ?? "[]"
  ) as DataSource[];
  const existingResources = JSON.parse(
    build.data.resources ?? "[]"
  ) as Resource[];

  const presets = await buildOrgResourcePresets({
    projectId,
    apiBaseUrl,
    readToken,
  });

  const update = await client
    .from("Build")
    .update({
      dataSources: JSON.stringify(
        mergeById(existingDataSources, presets.dataSources)
      ),
      resources: JSON.stringify(
        mergeById(existingResources, presets.resources)
      ),
    })
    .eq("id", build.data.id);
  if (update.error) {
    throw update.error;
  }
};
