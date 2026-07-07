import { describe, expect, test, vi } from "vitest";
import {
  createOrganizeosPublisher,
  parseOrganizationIdFromServiceEmail,
  resolveOrganizationIdForBuild,
} from "./organizeos-publisher.server";

const makeClient = (rows: Record<string, Record<string, unknown> | null>) => ({
  from: (table: string) => ({
    select: () => ({
      eq: () => ({
        single: async () => ({
          data: rows[table] ?? null,
          error: rows[table] === null ? { message: "not found" } : null,
        }),
      }),
    }),
  }),
});

const ORG_ID = "f0e1d2c3-b4a5-4697-8877-665544332211";
const HAPPY_ROWS = {
  Build: { projectId: "proj-1" },
  Project: { userId: "svc-user-1" },
  User: { email: `org+${ORG_ID}@svc.organizeos.internal` },
};

describe("parseOrganizationIdFromServiceEmail", () => {
  test("extracts the org id from a synthetic owner email", () => {
    expect(
      parseOrganizationIdFromServiceEmail(
        `org+${ORG_ID}@svc.organizeos.internal`
      )
    ).toBe(ORG_ID);
  });

  test("returns null for human emails", () => {
    expect(parseOrganizationIdFromServiceEmail("admin@example.org")).toBeNull();
    expect(
      parseOrganizationIdFromServiceEmail("org+x@svc.other.internal")
    ).toBeNull();
  });
});

describe("resolveOrganizationIdForBuild", () => {
  test("resolves build -> project -> service owner -> org id", async () => {
    expect(
      await resolveOrganizationIdForBuild(makeClient(HAPPY_ROWS), "build-1")
    ).toBe(ORG_ID);
  });

  test("returns null when the owner is a human account", async () => {
    const client = makeClient({
      ...HAPPY_ROWS,
      User: { email: "human@example.org" },
    });
    expect(await resolveOrganizationIdForBuild(client, "build-1")).toBeNull();
  });

  test("returns null when any hop is missing", async () => {
    const client = makeClient({ ...HAPPY_ROWS, Project: null });
    expect(await resolveOrganizationIdForBuild(client, "build-1")).toBeNull();
  });
});

describe("createOrganizeosPublisher", () => {
  const deps = {
    client: makeClient(HAPPY_ROWS),
    repo: "OrganizeOS-HQ/websites-builder",
    githubToken: "gh-token",
  };

  test("dispatches the workflow with build + org inputs", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const publisher = createOrganizeosPublisher({ ...deps, fetcher });

    const result = await (
      publisher.publish.mutate as (input: {
        buildId: string;
      }) => Promise<{ success: boolean }>
    )({ buildId: "build-1" });

    expect(result).toEqual({ success: true });
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://api.github.com/repos/OrganizeOS-HQ/websites-builder/actions/workflows/publish-site.yml/dispatches"
    );
    expect(JSON.parse(init.body as string)).toEqual({
      ref: "main",
      inputs: { build_id: "build-1", organization_id: ORG_ID },
    });
  });

  test("fails with generic copy for a non-service-owned project", async () => {
    const fetcher = vi.fn();
    const publisher = createOrganizeosPublisher({
      ...deps,
      client: makeClient({ ...HAPPY_ROWS, User: { email: "me@example.org" } }),
      fetcher,
    });
    const result = await (
      publisher.publish.mutate as (input: {
        buildId: string;
      }) => Promise<{ success: boolean; error?: string }>
    )({ buildId: "build-1" });

    expect(result.success).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("fails with generic copy when the dispatch is rejected", async () => {
    const fetcher = vi.fn(async () => new Response("nope", { status: 401 }));
    const publisher = createOrganizeosPublisher({ ...deps, fetcher });
    const result = await (
      publisher.publish.mutate as (input: {
        buildId: string;
      }) => Promise<{ success: boolean; error?: string }>
    )({ buildId: "build-1" });

    expect(result.success).toBe(false);
    // Never leak provider/status detail into user-facing copy.
    expect(JSON.stringify(result)).not.toMatch(/github|401/i);
  });
});
