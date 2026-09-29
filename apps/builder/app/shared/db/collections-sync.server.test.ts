import { describe, expect, test } from "vitest";
import type { DataSource, Resource } from "@webstudio-is/sdk";
import { syncOrgCollectionPresets } from "./collections-sync.server";
import { deriveProjectId } from "./provision.server";
import { buildOrgResourcePresets, upsertById } from "./resource-presets.server";
import collectionsFixture from "./__fixtures__/v1/collections.json";

const organizationId = "org-1";
const projectId = deriveProjectId(organizationId);
const apiBaseUrl = "https://app.example.org/api/public/v1";

type BuildRow = {
  id: string;
  version: number;
  dataSources: string;
  resources: string;
};

type Write = {
  payload: Record<string, unknown>;
  options: unknown;
  match: Record<string, unknown>;
};

// Stateful fake of the two tables the sync touches. The Build update honours
// its match on version the way PostgREST does: no row matches, count 0. Each
// `builderSaves` entry is a builder save that lands just before a write:
// it bumps the version (and may add to the build), so that write loses.
const makeContext = ({
  project = { id: projectId, isDeleted: false },
  build,
  builderSaves = [],
  writeError = null,
}: {
  project?: { id: string; isDeleted: boolean } | null;
  build: Partial<BuildRow> | null;
  builderSaves?: Array<(row: BuildRow) => void>;
  writeError?: { message: string } | null;
}) => {
  const row: BuildRow | null =
    build === null
      ? null
      : {
          id: "build-1",
          version: 7,
          dataSources: "[]",
          resources: "[]",
          ...build,
        };
  const state = { row, reads: 0, writes: [] as Write[] };
  const pendingSaves = [...builderSaves];

  const client = {
    from: (table: string) => {
      if (table === "Project") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: project, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              single: async () => {
                state.reads += 1;
                return state.row === null
                  ? { data: null, error: { message: "not found" } }
                  : { data: { ...state.row }, error: null };
              },
            }),
          }),
        }),
        update: (payload: Record<string, unknown>, options: unknown) => ({
          match: async (match: Record<string, unknown>) => {
            state.writes.push({ payload, options, match });
            if (writeError !== null) {
              return { error: writeError, count: null };
            }
            const save = pendingSaves.shift();
            if (save !== undefined && state.row !== null) {
              save(state.row);
              state.row.version += 1;
            }
            if (state.row === null || state.row.version !== match.version) {
              return { error: null, count: 0 };
            }
            Object.assign(state.row, payload);
            return { error: null, count: 1 };
          },
        }),
      };
    },
  };
  return { context: { postgrest: { client } } as never, state };
};

const staticPresets = buildOrgResourcePresets({
  projectId,
  apiBaseUrl,
  readToken: "osk_secrettoken",
});

const provisionedBuild = (): Partial<BuildRow> => ({
  dataSources: JSON.stringify(staticPresets.dataSources),
  resources: JSON.stringify(staticPresets.resources),
});

const collections = [
  { slug: "blog", name: "Blog posts", kind: "curated" },
  { slug: "team", name: "Team", kind: "platform" },
];

const parseRow = (row: BuildRow | null) => ({
  dataSources: JSON.parse(row?.dataSources ?? "[]") as DataSource[],
  resources: JSON.parse(row?.resources ?? "[]") as Resource[],
});

const userVariable: DataSource = {
  type: "variable",
  id: "user-var",
  name: "My variable",
  value: { type: "string", value: "keep me" },
};

const userResource: Resource = {
  id: "user-resource",
  name: "My resource",
  method: "get",
  url: `"https://example.org/data"`,
  headers: [],
};

describe("syncOrgCollectionPresets", () => {
  test("no project for the organization", async () => {
    const { context, state } = makeContext({ project: null, build: {} });
    expect(
      await syncOrgCollectionPresets(context, { organizationId, collections })
    ).toEqual({ status: "no-project" });
    expect(state.reads).toBe(0);
    expect(state.writes).toEqual([]);
  });

  test("a soft-deleted project counts as no project", async () => {
    const { context, state } = makeContext({
      project: { id: projectId, isDeleted: true },
      build: provisionedBuild(),
    });
    expect(
      await syncOrgCollectionPresets(context, { organizationId, collections })
    ).toEqual({ status: "no-project" });
    expect(state.writes).toEqual([]);
  });

  test("no static presets to copy from: nothing is written", async () => {
    const { context, state } = makeContext({
      build: {
        dataSources: JSON.stringify([userVariable]),
        resources: JSON.stringify([userResource]),
      },
    });
    expect(
      await syncOrgCollectionPresets(context, { organizationId, collections })
    ).toEqual({ status: "no-presets" });
    expect(state.writes).toEqual([]);
  });

  test("seeds one Resource and binding per collection after the static presets", async () => {
    const { context, state } = makeContext({ build: provisionedBuild() });

    expect(
      await syncOrgCollectionPresets(context, { organizationId, collections })
    ).toEqual({ status: "ok", collections: 2 });

    const { dataSources, resources } = parseRow(state.row);
    expect(resources.map((resource) => resource.name)).toEqual([
      "Events",
      "Fundraisers",
      "Stats",
      "Blog posts",
      "Team",
    ]);
    expect(dataSources.map((dataSource) => dataSource.name)).toEqual([
      "Events",
      "Fundraisers",
      "Stats",
      "Blog posts",
      "Team",
    ]);
    // Base and token come from the static presets, verbatim.
    expect(resources[3]).toMatchObject({
      method: "get",
      url: `"${apiBaseUrl}/collections/blog/items"`,
      headers: [{ name: "Authorization", value: `"Bearer osk_secrettoken"` }],
    });
    const binding = dataSources[3];
    expect(binding).toMatchObject({
      type: "resource",
      resourceId: resources[3].id,
    });
    expect(binding).not.toHaveProperty("scopeInstanceId");
  });

  test("writes with compare-and-swap on the version it read, without bumping it", async () => {
    const { context, state } = makeContext({ build: provisionedBuild() });
    await syncOrgCollectionPresets(context, { organizationId, collections });

    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].options).toEqual({ count: "exact" });
    expect(state.writes[0].match).toEqual({ id: "build-1", version: 7 });
    expect(Object.keys(state.writes[0].payload).sort()).toEqual([
      "dataSources",
      "resources",
    ]);
    expect(state.row?.version).toBe(7);
  });

  test("keeps user-authored entries untouched and in their order", async () => {
    const { context, state } = makeContext({
      build: {
        dataSources: JSON.stringify([
          userVariable,
          ...staticPresets.dataSources,
        ]),
        resources: JSON.stringify([userResource, ...staticPresets.resources]),
      },
    });
    await syncOrgCollectionPresets(context, { organizationId, collections });

    const { dataSources, resources } = parseRow(state.row);
    expect(dataSources.map((dataSource) => dataSource.id)).toEqual([
      userVariable.id,
      ...staticPresets.dataSources.map((dataSource) => dataSource.id),
      expect.any(String),
      expect.any(String),
    ]);
    expect(dataSources[0]).toEqual(userVariable);
    expect(resources[0]).toEqual(userResource);
    expect(resources.slice(1, 4)).toEqual(staticPresets.resources);
    expect(resources).toHaveLength(6);
  });

  test("a preset stays ahead of entries the admin added after it", async () => {
    const seeded = makeContext({ build: provisionedBuild() });
    await syncOrgCollectionPresets(seeded.context, {
      organizationId,
      collections,
    });
    const afterSeed = parseRow(seeded.state.row);

    // The admin adds a variable and a resource behind the collection presets.
    const { context, state } = makeContext({
      build: {
        dataSources: JSON.stringify([...afterSeed.dataSources, userVariable]),
        resources: JSON.stringify([...afterSeed.resources, userResource]),
      },
    });

    // Unchanged snapshot: still no write, so the panel is not reshuffled.
    await syncOrgCollectionPresets(context, { organizationId, collections });
    expect(state.writes).toEqual([]);

    await syncOrgCollectionPresets(context, {
      organizationId,
      collections: [{ slug: "blog", name: "Journal" }, collections[1]],
    });
    const after = parseRow(state.row);
    expect(after.dataSources.map((dataSource) => dataSource.name)).toEqual([
      "Events",
      "Fundraisers",
      "Stats",
      "Journal",
      "Team",
      "My variable",
    ]);
    expect(after.resources.map((resource) => resource.name)).toEqual([
      "Events",
      "Fundraisers",
      "Stats",
      "Journal",
      "Team",
      "My resource",
    ]);
  });

  test("a second identical run performs no write", async () => {
    const { context, state } = makeContext({ build: provisionedBuild() });
    await syncOrgCollectionPresets(context, { organizationId, collections });
    expect(state.writes).toHaveLength(1);

    expect(
      await syncOrgCollectionPresets(context, { organizationId, collections })
    ).toEqual({ status: "ok", collections: 2 });
    expect(state.writes).toHaveLength(1);
  });

  test("a rename updates the names in place and keeps the ids and order", async () => {
    const { context, state } = makeContext({
      build: {
        dataSources: JSON.stringify([
          userVariable,
          ...staticPresets.dataSources,
        ]),
        resources: provisionedBuild().resources,
      },
    });
    await syncOrgCollectionPresets(context, { organizationId, collections });
    const before = parseRow(state.row);

    await syncOrgCollectionPresets(context, {
      organizationId,
      collections: [{ slug: "blog", name: "Journal" }, collections[1]],
    });
    const after = parseRow(state.row);

    expect(after.resources.map((resource) => resource.id)).toEqual(
      before.resources.map((resource) => resource.id)
    );
    expect(after.dataSources.map((dataSource) => dataSource.id)).toEqual(
      before.dataSources.map((dataSource) => dataSource.id)
    );
    expect(after.resources.map((resource) => resource.name)).toEqual([
      "Events",
      "Fundraisers",
      "Stats",
      "Journal",
      "Team",
    ]);
    expect(after.dataSources.map((dataSource) => dataSource.name)).toEqual([
      "My variable",
      "Events",
      "Fundraisers",
      "Stats",
      "Journal",
      "Team",
    ]);
  });

  test("follows a token rotated by a re-provision on the next sync", async () => {
    const { context, state } = makeContext({ build: provisionedBuild() });
    await syncOrgCollectionPresets(context, { organizationId, collections });

    // Provisioning with a new token rewrites the static presets in place.
    const rotated = buildOrgResourcePresets({
      projectId,
      apiBaseUrl,
      readToken: "osk_rotated",
    });
    const stored = parseRow(state.row);
    if (state.row !== null) {
      state.row.resources = JSON.stringify(
        upsertById(stored.resources, rotated.resources)
      );
    }

    await syncOrgCollectionPresets(context, { organizationId, collections });

    expect(state.writes).toHaveLength(2);
    for (const resource of parseRow(state.row).resources) {
      expect(resource.headers).toEqual([
        { name: "Authorization", value: `"Bearer osk_rotated"` },
      ]);
    }
  });

  test("skips a platform collection a static preset covers, and counts the rest", async () => {
    const { context, state } = makeContext({ build: provisionedBuild() });
    expect(
      await syncOrgCollectionPresets(context, {
        organizationId,
        collections: [
          { slug: "events", name: "Events", kind: "platform" },
          { slug: "blog", name: "Blog posts", kind: "curated" },
        ],
      })
    ).toEqual({ status: "ok", collections: 1 });
    expect(parseRow(state.row).resources).toHaveLength(4);
  });

  test("retries after a builder save lands first, and keeps what it saved", async () => {
    const { context, state } = makeContext({
      build: provisionedBuild(),
      builderSaves: [
        (row) => {
          row.dataSources = JSON.stringify([
            ...JSON.parse(row.dataSources),
            userVariable,
          ]);
        },
      ],
    });

    expect(
      await syncOrgCollectionPresets(context, { organizationId, collections })
    ).toEqual({ status: "ok", collections: 2 });

    expect(state.reads).toBe(2);
    expect(state.writes.map((write) => write.match.version)).toEqual([7, 8]);
    // The builder's own save survived: the retry re-read it.
    expect(
      parseRow(state.row).dataSources.map((dataSource) => dataSource.id)
    ).toContain(userVariable.id);
    expect(parseRow(state.row).resources).toHaveLength(5);
    expect(state.row?.version).toBe(8);
  });

  test("gives up after three attempts when the builder keeps saving", async () => {
    const { context, state } = makeContext({
      build: provisionedBuild(),
      builderSaves: [() => {}, () => {}, () => {}],
    });

    expect(
      await syncOrgCollectionPresets(context, { organizationId, collections })
    ).toEqual({ status: "conflict" });
    expect(state.reads).toBe(3);
    expect(state.writes).toHaveLength(3);
    // Nothing of ours landed.
    expect(parseRow(state.row).resources).toHaveLength(3);
  });

  test("throws when the dev build cannot be loaded", async () => {
    const { context } = makeContext({ build: null });
    await expect(
      syncOrgCollectionPresets(context, { organizationId, collections })
    ).rejects.toBeTruthy();
  });

  test("throws on a write error", async () => {
    const writeError = { message: "write failed" };
    const { context } = makeContext({ build: provisionedBuild(), writeError });
    await expect(
      syncOrgCollectionPresets(context, { organizationId, collections })
    ).rejects.toBe(writeError);
  });

  // The payload OrganizeOS sends today: /v1/collections as the API returns it,
  // with the extras (itemCount, options, references) the builder ignores.
  test("seeds the three collections of the canonical OrganizeOS fixture", async () => {
    const { context, state } = makeContext({ build: provisionedBuild() });

    expect(
      await syncOrgCollectionPresets(context, {
        organizationId,
        collections: collectionsFixture.data,
      })
    ).toEqual({ status: "ok", collections: 3 });

    const { dataSources, resources } = parseRow(state.row);
    expect(resources.slice(3).map((resource) => resource.name)).toEqual([
      "Blog posts",
      "Team",
      "Tags",
    ]);
    expect(resources.slice(3).map((resource) => resource.url)).toEqual([
      `"${apiBaseUrl}/collections/blog/items"`,
      `"${apiBaseUrl}/collections/team/items"`,
      `"${apiBaseUrl}/collections/tags/items"`,
    ]);
    expect(dataSources.slice(3).map((dataSource) => dataSource.name)).toEqual([
      "Blog posts",
      "Team",
      "Tags",
    ]);
  });
});
