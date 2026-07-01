import { describe, expect, test } from "vitest";
import { encodeDataVariableId, type DataSource } from "@webstudio-is/sdk";
import {
  buildOrgResourcePresets,
  seedProjectResourcePresets,
  V1_RESOURCE_PRESETS,
} from "./resource-presets.server";

describe("buildOrgResourcePresets", () => {
  const args = {
    projectId: "project-1",
    apiBaseUrl: "https://app.example.org/api/public/v1",
    readToken: "osk_secrettoken",
  };

  test("emits one GET Resource per preset plus a token variable and bindings", () => {
    const { dataSources, resources } = buildOrgResourcePresets(args);

    expect(resources).toHaveLength(V1_RESOURCE_PRESETS.length);
    // token variable + one resource binding per preset
    expect(dataSources).toHaveLength(V1_RESOURCE_PRESETS.length + 1);

    for (const resource of resources) {
      expect(resource.method).toBe("get");
    }
  });

  test("stores the token as a string variable and binds it in the auth header", () => {
    const { dataSources, resources } = buildOrgResourcePresets(args);

    const tokenVariable = dataSources.find(
      (source): source is Extract<DataSource, { type: "variable" }> =>
        source.type === "variable"
    );
    expect(tokenVariable?.value).toEqual({
      type: "string",
      value: "osk_secrettoken",
    });

    const expectedAuth = `"Bearer " + ${encodeDataVariableId(tokenVariable!.id)}`;
    for (const resource of resources) {
      expect(resource.headers).toEqual([
        { name: "Authorization", value: expectedAuth },
      ]);
    }
  });

  test("builds quoted-literal URLs and trims a trailing slash on the base", () => {
    const { resources } = buildOrgResourcePresets({
      ...args,
      apiBaseUrl: "https://app.example.org/api/public/v1/",
    });
    const urls = resources.map((r) => r.url).sort();
    expect(urls).toEqual(
      [
        `"https://app.example.org/api/public/v1/events"`,
        `"https://app.example.org/api/public/v1/fundraisers"`,
        `"https://app.example.org/api/public/v1/stats"`,
      ].sort()
    );
  });

  test("every resource binding references a real resource id", () => {
    const { dataSources, resources } = buildOrgResourcePresets(args);
    const resourceIds = new Set(resources.map((r) => r.id));
    const bindings = dataSources.filter((s) => s.type === "resource");
    expect(bindings).toHaveLength(V1_RESOURCE_PRESETS.length);
    for (const binding of bindings) {
      expect(resourceIds.has(binding.resourceId)).toBe(true);
    }
  });

  test("ids are deterministic per project and differ across projects", () => {
    const a1 = buildOrgResourcePresets(args);
    const a2 = buildOrgResourcePresets(args);
    const b = buildOrgResourcePresets({ ...args, projectId: "project-2" });

    expect(a1.resources.map((r) => r.id)).toEqual(
      a2.resources.map((r) => r.id)
    );
    expect(a1.dataSources.map((d) => d.id)).toEqual(
      a2.dataSources.map((d) => d.id)
    );
    // Different project -> different ids (no cross-project collision).
    expect(a1.resources[0].id).not.toBe(b.resources[0].id);
  });
});

describe("seedProjectResourcePresets", () => {
  const args = {
    projectId: "project-1",
    apiBaseUrl: "https://app.example.org/api/public/v1",
    readToken: "osk_secrettoken",
  };

  // Minimal chainable Build-table mock: select().eq().is().single() resolves the
  // stored row; update().eq() records the written payload.
  const makeContext = (row: {
    dataSources: string | null;
    resources: string | null;
  }) => {
    const updates: Array<Record<string, unknown>> = [];
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              single: async () => ({
                data: { id: "build-1", ...row },
                error: null,
              }),
            }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          updates.push(payload);
          return { eq: async () => ({ error: null }) };
        },
      }),
    };
    return { context: { postgrest: { client } } as never, updates };
  };

  test("merges presets into an empty build", async () => {
    const { context, updates } = makeContext({
      dataSources: "[]",
      resources: "[]",
    });
    await seedProjectResourcePresets(context, args);

    expect(updates).toHaveLength(1);
    const writtenResources = JSON.parse(updates[0].resources as string);
    const writtenDataSources = JSON.parse(updates[0].dataSources as string);
    expect(writtenResources).toHaveLength(V1_RESOURCE_PRESETS.length);
    expect(writtenDataSources).toHaveLength(V1_RESOURCE_PRESETS.length + 1);
  });

  test("is idempotent: re-seeding replaces presets in place, not duplicating", async () => {
    const first = buildOrgResourcePresets(args);
    const { context, updates } = makeContext({
      dataSources: JSON.stringify(first.dataSources),
      resources: JSON.stringify(first.resources),
    });
    await seedProjectResourcePresets(context, args);

    const writtenResources = JSON.parse(updates[0].resources as string);
    const writtenDataSources = JSON.parse(updates[0].dataSources as string);
    expect(writtenResources).toHaveLength(V1_RESOURCE_PRESETS.length);
    expect(writtenDataSources).toHaveLength(V1_RESOURCE_PRESETS.length + 1);
  });

  test("preserves unrelated user-authored dataSources and resources", async () => {
    const userVariable: DataSource = {
      type: "variable",
      id: "user-var",
      name: "My variable",
      value: { type: "string", value: "keep me" },
    };
    const { context, updates } = makeContext({
      dataSources: JSON.stringify([userVariable]),
      resources: "[]",
    });
    await seedProjectResourcePresets(context, args);

    const writtenDataSources = JSON.parse(
      updates[0].dataSources as string
    ) as DataSource[];
    expect(writtenDataSources.some((d) => d.id === "user-var")).toBe(true);
    // user var + token var + 3 bindings
    expect(writtenDataSources).toHaveLength(V1_RESOURCE_PRESETS.length + 2);
  });

  test("throws when the dev build cannot be loaded", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              single: async () => ({
                data: null,
                error: { message: "not found" },
              }),
            }),
          }),
        }),
      }),
    };
    await expect(
      seedProjectResourcePresets({ postgrest: { client } } as never, args)
    ).rejects.toBeTruthy();
  });
});
