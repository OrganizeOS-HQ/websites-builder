import { beforeEach, describe, expect, test, vi } from "vitest";

// Routes read the environment once, when first imported
const { fake } = vi.hoisted(() => {
  Object.assign(process.env, {
    ORGANIZEOS_PROVISION_TOKEN: "provision-secret",
    POSTGREST_URL: "https://postgrest.test",
    POSTGREST_API_KEY: "postgrest-key",
  });
  return {
    fake: {
      client: undefined as unknown,
    },
  };
});

vi.mock("@webstudio-is/postgrest/index.server", () => ({
  createClient: () => fake.client,
}));

import { action } from "~/routes/internal.collections-sync";
import { deriveProjectId } from "~/shared/db/provision.server";
import { buildOrgResourcePresets } from "~/shared/db/resource-presets.server";
import collectionsFixture from "~/shared/db/__fixtures__/v1/collections.json";

const organizationId = "org-1";
const projectId = deriveProjectId(organizationId);

type FakeState = {
  project: { id: string; isDeleted: boolean } | null;
  build: {
    id: string;
    version: number;
    dataSources: string;
    resources: string;
  };
  // Builder saves that land before the sync's write, each one making it lose.
  losingWrites: number;
  writes: number;
};

const presets = buildOrgResourcePresets({
  projectId,
  apiBaseUrl: "https://app.example.org/api/public/v1",
  readToken: "osk_secrettoken",
});

const state: FakeState = {
  project: null,
  build: { id: "build-1", version: 1, dataSources: "[]", resources: "[]" },
  losingWrites: 0,
  writes: 0,
};

beforeEach(() => {
  state.project = { id: projectId, isDeleted: false };
  state.build = {
    id: "build-1",
    version: 1,
    dataSources: JSON.stringify(presets.dataSources),
    resources: JSON.stringify(presets.resources),
  };
  state.losingWrites = 0;
  state.writes = 0;
  fake.client = {
    from: (table: string) =>
      table === "Project"
        ? {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: state.project, error: null }),
              }),
            }),
          }
        : {
            select: () => ({
              eq: () => ({
                is: () => ({
                  single: async () => ({
                    data: { ...state.build },
                    error: null,
                  }),
                }),
              }),
            }),
            update: (payload: Record<string, string>) => ({
              match: async (match: { version: number }) => {
                state.writes += 1;
                if (state.losingWrites > 0) {
                  state.losingWrites -= 1;
                  state.build.version += 1;
                }
                if (match.version !== state.build.version) {
                  return { error: null, count: 0 };
                }
                Object.assign(state.build, payload);
                return { error: null, count: 1 };
              },
            }),
          },
  };
});

const call = async ({
  method = "POST",
  headers = { Authorization: "provision-secret" },
  body = { organizationId, collections: [{ slug: "blog", name: "Blog" }] },
}: {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
} = {}) => {
  const response = await action({
    request: new Request("https://builder.test/internal/collections-sync", {
      method,
      headers,
      body:
        method === "GET" || method === "HEAD"
          ? undefined
          : typeof body === "string"
            ? body
            : JSON.stringify(body),
    }),
    params: {},
    context: {},
  });
  return { status: response.status, json: await response.json() };
};

describe("POST /internal/collections-sync", () => {
  test("405 for anything but POST", async () => {
    expect(await call({ method: "GET" })).toEqual({
      status: 405,
      json: { error: "Method not allowed" },
    });
    expect((await call({ method: "PUT" })).status).toBe(405);
  });

  describe("401", () => {
    const unauthorized = { status: 401, json: { error: "Unauthorized" } };

    test("without an Authorization header", async () => {
      expect(await call({ headers: {} })).toEqual(unauthorized);
    });

    test("with the wrong token", async () => {
      expect(await call({ headers: { Authorization: "nope" } })).toEqual(
        unauthorized
      );
      // The token is sent raw: no Bearer prefix.
      expect(
        await call({ headers: { Authorization: "Bearer provision-secret" } })
      ).toEqual(unauthorized);
    });

    test("with any Cookie header, even alongside the right token", async () => {
      expect(
        await call({
          headers: { Authorization: "provision-secret", Cookie: "a=b" },
        })
      ).toEqual(unauthorized);
    });

    test("and the database is never touched", async () => {
      fake.client = undefined;
      await call({ headers: {} });
      expect(state.writes).toBe(0);
    });
  });

  describe("400", () => {
    const invalid = {
      status: 400,
      json: { error: "Invalid collections sync request" },
    };

    test("for a body that is not JSON", async () => {
      expect(await call({ body: "{not json" })).toEqual(invalid);
    });

    test("for a body that is not an object", async () => {
      expect(await call({ body: [] })).toEqual(invalid);
      expect(await call({ body: "null" })).toEqual(invalid);
    });

    test("for a missing or empty organizationId", async () => {
      expect(await call({ body: { collections: [] } })).toEqual(invalid);
      expect(
        await call({ body: { organizationId: "", collections: [] } })
      ).toEqual(invalid);
    });

    test("for missing collections", async () => {
      expect(await call({ body: { organizationId } })).toEqual(invalid);
    });

    test.each([
      "Blog Posts",
      "Blog",
      "-blog",
      "blog-",
      "a/b",
      "",
      "a".repeat(64),
    ])("for the slug %j", async (slug) => {
      expect(
        await call({
          body: { organizationId, collections: [{ slug, name: "Blog" }] },
        })
      ).toEqual(invalid);
    });

    test("for a missing, empty or oversized name", async () => {
      for (const name of [undefined, "", "x".repeat(201)]) {
        expect(
          await call({
            body: { organizationId, collections: [{ slug: "blog", name }] },
          })
        ).toEqual(invalid);
      }
    });

    test("for more than 500 collections", async () => {
      const collections = Array.from({ length: 501 }, (_, index) => ({
        slug: `c${index}`,
        name: `Collection ${index}`,
      }));
      expect(await call({ body: { organizationId, collections } })).toEqual(
        invalid
      );
    });

    test("and nothing is written", async () => {
      await call({ body: { organizationId, collections: [{ slug: "X" }] } });
      expect(state.writes).toBe(0);
    });
  });

  test("422 when the organization has no project", async () => {
    state.project = null;
    expect(await call()).toEqual({
      status: 422,
      json: { error: "no project for organization" },
    });
  });

  test("422 when the project is deleted", async () => {
    state.project = { id: projectId, isDeleted: true };
    expect(await call()).toEqual({
      status: 422,
      json: { error: "no project for organization" },
    });
    expect(state.writes).toBe(0);
  });

  test("409 when the project has no data presets", async () => {
    state.build.resources = "[]";
    state.build.dataSources = "[]";
    expect(await call()).toEqual({
      status: 409,
      json: { error: "project has no data presets" },
    });
    expect(state.writes).toBe(0);
  });

  test("200 with the number of collection presets", async () => {
    expect(await call()).toEqual({
      status: 200,
      json: { ok: true, collections: 1 },
    });
    expect(state.writes).toBe(1);
    expect(JSON.parse(state.build.resources)).toHaveLength(4);
  });

  test("200 for the canonical OrganizeOS collections payload", async () => {
    // Every key OrganizeOS sends, including the ones the builder ignores.
    expect(
      await call({
        body: { organizationId, collections: collectionsFixture.data },
      })
    ).toEqual({ status: 200, json: { ok: true, collections: 3 } });
    expect(
      JSON.parse(state.build.resources)
        .slice(3)
        .map((resource: { name: string }) => resource.name)
    ).toEqual(["Blog posts", "Team", "Tags"]);
  });

  test("200 for an entry with every optional key", async () => {
    expect(
      await call({
        body: {
          organizationId,
          collections: [
            {
              id: "col_1",
              slug: "blog",
              name: "Blog posts",
              singularName: "Blog post",
              kind: "curated",
              contentUrl: "https://app.example.org/blog",
              fields: [{ key: "title", label: "Title", kind: "text", x: 1 }],
              somethingNew: true,
            },
          ],
        },
      })
    ).toEqual({ status: 200, json: { ok: true, collections: 1 } });
  });

  test("200 and no write when nothing changed", async () => {
    await call();
    expect(state.writes).toBe(1);
    expect(await call()).toEqual({
      status: 200,
      json: { ok: true, collections: 1 },
    });
    expect(state.writes).toBe(1);
  });

  test("200 after one lost race", async () => {
    state.losingWrites = 1;
    expect(await call()).toEqual({
      status: 200,
      json: { ok: true, collections: 1 },
    });
    expect(state.writes).toBe(2);
  });

  test("503 when the build keeps changing under the sync", async () => {
    state.losingWrites = 3;
    expect(await call()).toEqual({
      status: 503,
      json: { error: "build changed during sync; retry" },
    });
    expect(state.writes).toBe(3);
  });
});
