import { describe, expect, test } from "vitest";
import {
  createTestServer,
  db,
  testContext,
  json,
} from "@webstudio-is/postgrest/testing";
import {
  markBuildPublishStatus,
  type BuildStatusClient,
} from "./publish-status.server";

const server = createTestServer();

// The real client satisfies the structural slice the helper asks for.
const client = testContext.postgrest.client as unknown as BuildStatusClient;

describe("markBuildPublishStatus", () => {
  test("patches only the named production build and reports a hit", async () => {
    let patchUrl: URL | undefined;
    let patchBody: unknown;
    server.use(
      db.patch("Build", async ({ request }) => {
        patchUrl = new URL(request.url);
        patchBody = await request.json();
        return json([{ id: "build-1" }]);
      })
    );

    await expect(
      markBuildPublishStatus(client, {
        buildId: "build-1",
        status: "PUBLISHED",
      })
    ).resolves.toBe(true);

    expect(patchBody).toEqual({ publishStatus: "PUBLISHED" });
    expect(patchUrl?.searchParams.get("id")).toBe("eq.build-1");
    // Never touches the dev build (deployment is null).
    expect(patchUrl?.searchParams.get("deployment")).toBe("not.is.null");
  });

  test("reports a miss when no production build matches", async () => {
    server.use(db.patch("Build", () => json([])));

    await expect(
      markBuildPublishStatus(client, { buildId: "missing", status: "FAILED" })
    ).resolves.toBe(false);
  });

  test("throws on a store error", async () => {
    server.use(
      db.patch("Build", () => json({ message: "down" }, { status: 500 }))
    );

    await expect(
      markBuildPublishStatus(client, { buildId: "build-1", status: "FAILED" })
    ).rejects.toBeTruthy();
  });
});
