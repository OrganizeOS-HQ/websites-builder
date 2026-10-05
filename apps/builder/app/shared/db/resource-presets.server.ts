import { createHash } from "node:crypto";
import type { DataSource, Resource } from "@webstudio-is/sdk";
import type { AppContext } from "@webstudio-is/trpc-interface/index.server";

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
 * (e.g. rotating the token value) instead of duplicating presets.
 */

// Fixed namespace for preset-derived ids. Do not change: it would orphan the
// presets already seeded into live projects.
const PRESET_NAMESPACE = "3f2a1b7c-8d5e-45a1-9b2c-6e0d1a2b3c4d";

/** RFC 4122 v5 (SHA-1, namespaced) UUID, deterministic per name. */
const uuidV5 = (name: string): string => {
  const namespaceBytes = Buffer.from(PRESET_NAMESPACE.replace(/-/g, ""), "hex");
  const bytes = createHash("sha1")
    .update(namespaceBytes)
    .update(Buffer.from(name, "utf8"))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

/**
 * The /v1 read endpoints exposed as data-binding presets. These are the frozen
 * public GET DTOs from Phase 1 (see the OrganizeOS ledger repo). Write surfaces
 * (donate/signup form submission) are a separate mechanism and not seeded here.
 */
export const V1_RESOURCE_PRESETS = [
  { key: "events", label: "Events", path: "/events" },
  { key: "fundraisers", label: "Fundraisers", path: "/fundraisers" },
  { key: "stats", label: "Stats", path: "/stats" },
] as const;

export type OrgResourcePresets = {
  dataSources: DataSource[];
  resources: Resource[];
};

/**
 * Build the preset Resources + DataSources for an org's project. Pure: returns
 * the objects to merge into a build, touches no I/O.
 */
export const buildOrgResourcePresets = ({
  projectId,
  apiBaseUrl,
  readToken,
}: {
  projectId: string;
  apiBaseUrl: string;
  readToken: string;
}): OrgResourcePresets => {
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
    const resourceId = uuidV5(`${projectId}:v1:${preset.key}:resource`);
    const bindingId = uuidV5(`${projectId}:v1:${preset.key}:binding`);

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

/**
 * OrganizeOS's rule for a collection slug. The builder validates against the
 * same rule, so it accepts exactly the slugs the API serves.
 */
export const COLLECTION_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type CollectionPresetInput = {
  slug: string;
  name: string;
  kind?: string;
};

/** What a collection preset copies from a static preset already in the build. */
export type V1PresetSeed = {
  /** The /v1 API base, i.e. a static preset's url minus its path. */
  apiBase: string;
  /** The Authorization header value: already an expression, copied verbatim. */
  authHeaderExpression: string;
};

/**
 * Read the API base and the Authorization header expression back out of a
 * static /v1 preset (events, fundraisers, stats) in the build. A collections
 * sync carries no token, and the preset Resources are the one place the org's
 * token already lives, so the collection presets are seeded from them. Returns
 * the first preset that yields both, or undefined when none does (a project
 * provisioned without a read token, or presets the admin rewrote by hand).
 */
export const readV1PresetSeed = ({
  projectId,
  resources,
}: {
  projectId: string;
  resources: Resource[];
}): V1PresetSeed | undefined => {
  for (const preset of V1_RESOURCE_PRESETS) {
    const resourceId = uuidV5(`${projectId}:v1:${preset.key}:resource`);
    const resource = resources.find((item) => item.id === resourceId);
    if (resource === undefined) {
      continue;
    }

    // The url is an expression. A literal is a JSON string; anything else the
    // admin wrote (a template with a variable) is not something to copy from.
    let url: unknown;
    try {
      url = JSON.parse(resource.url);
    } catch {
      continue;
    }
    if (typeof url !== "string" || url.endsWith(preset.path) === false) {
      continue;
    }
    const apiBase = url.slice(0, -preset.path.length);
    if (URL.canParse(apiBase) === false) {
      continue;
    }

    const authHeader = resource.headers?.find(
      (header) => header.name.toLowerCase() === "authorization"
    );
    if (authHeader === undefined || authHeader.value === "") {
      continue;
    }

    return { apiBase, authHeaderExpression: authHeader.value };
  }
};

/**
 * Build one Resource + binding DataSource per public collection, so a
 * collection's items can be bound in the builder's data panel like the static
 * presets. Pure. Ids derive from (projectId, slug), so a rename keeps them and
 * only updates the names.
 *
 * A slug listed twice keeps the last entry. A platform collection that a
 * static preset already covers (events, fundraisers, stats) is skipped; a
 * platform collection with any other slug is seeded like any other.
 */
export const buildCollectionResourcePresets = ({
  projectId,
  apiBase,
  authHeaderExpression,
  collections,
}: {
  projectId: string;
  apiBase: string;
  authHeaderExpression: string;
  collections: CollectionPresetInput[];
}): OrgResourcePresets => {
  const base = apiBase.replace(/\/+$/, "");
  const bySlug = new Map(
    collections.map((collection) => [collection.slug, collection])
  );

  const resources: Resource[] = [];
  const dataSources: DataSource[] = [];

  for (const collection of bySlug.values()) {
    const coveredByStaticPreset = V1_RESOURCE_PRESETS.some(
      (preset) => preset.key === collection.slug
    );
    if (collection.kind === "platform" && coveredByStaticPreset) {
      continue;
    }

    const resourceId = uuidV5(
      `${projectId}:v1:collection:${collection.slug}:resource`
    );
    const bindingId = uuidV5(
      `${projectId}:v1:collection:${collection.slug}:binding`
    );

    resources.push({
      id: resourceId,
      name: collection.name,
      method: "get",
      url: JSON.stringify(
        `${base}/collections/${encodeURIComponent(collection.slug)}/items`
      ),
      headers: [{ name: "Authorization", value: authHeaderExpression }],
    });

    dataSources.push({
      type: "resource",
      id: bindingId,
      name: collection.name,
      resourceId,
    });
  }

  return { dataSources, resources };
};

/**
 * Replace existing entries that share an incoming id where they stand, and
 * append the rest. Unlike mergeById this keeps the order of what is already
 * there, so a re-sync does not reshuffle the builder's data panel.
 */
export const upsertById = <Type extends { id: string }>(
  existing: Type[],
  incoming: Type[]
): Type[] => {
  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  const merged = existing.map((item) => incomingById.get(item.id) ?? item);
  const existingIds = new Set(existing.map((item) => item.id));
  return [...merged, ...incoming.filter((item) => !existingIds.has(item.id))];
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

  const presets = buildOrgResourcePresets({ projectId, apiBaseUrl, readToken });

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
