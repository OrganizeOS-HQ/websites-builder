import { describe, test, expect, afterEach } from "vitest";
import {
  createTestServer,
  db,
  testContext,
  json,
} from "@webstudio-is/postgrest/testing";
import type { AppContext } from "@webstudio-is/trpc-interface/index.server";
import { resolveTopics } from "./topic-resolvers.server";

const server = createTestServer();

afterEach(() => {
  delete process.env.PLANS;
});

const createContext = (userId = "user-1"): AppContext =>
  ({
    ...testContext,
    authorization: { type: "user", userId },
  }) as unknown as AppContext;

const anonymousContext = {
  ...testContext,
  authorization: { type: "anonymous" },
} as unknown as AppContext;

// Helper: member row with workspace embedded
const memberRow = (workspaceId: string, ownerId: string, name: string) => ({
  workspaceId,
  workspace: { userId: ownerId, name },
});

// ─── seatSuspended ─────────────────────────────────────────────

describe("notifications (msw)", () => {
  test("returns empty list for non-user authorization", async () => {
    const result = await resolveTopics(["notifications"], anonymousContext);
    expect(result.notifications).toEqual([]);
  });
});

describe("seatSuspended (msw)", () => {
  test("returns false for non-user authorization", async () => {
    const result = await resolveTopics(["seatSuspended"], anonymousContext);
    expect(result.seatSuspended).toBe(false);
  });

  test("returns false when user has no workspace memberships", async () => {
    server.use(db.get("WorkspaceMember", () => json([])));

    const result = await resolveTopics(["seatSuspended"], createContext());
    expect(result.seatSuspended).toBe(false);
  });

  test("returns false when all memberships are user's own workspaces", async () => {
    server.use(
      db.get("WorkspaceMember", () =>
        // workspace.userId === userId → filtered out as own workspace
        json([memberRow("ws-1", "user-1", "My Workspace")])
      )
    );

    const result = await resolveTopics(
      ["seatSuspended"],
      createContext("user-1")
    );
    expect(result.seatSuspended).toBe(false);
  });

  test("returns workspace name when owner has default (free) plan", async () => {
    server.use(
      db.get("WorkspaceMember", () =>
        json([memberRow("ws-owner", "owner-1", "Owner Workspace")])
      ),
      // Owner is a regular human user → stays in the seat check.
      db.get("User", () => json([{ id: "owner-1", provider: "github" }])),
      // getPlanInfo: no user products → defaultPlanFeatures (maxWorkspaces=1 → suspended)
      db.get("UserProduct", () => json([]))
    );

    const result = await resolveTopics(
      ["seatSuspended"],
      createContext("user-1")
    );
    expect(result.seatSuspended).toBe("Owner Workspace");
  });

  test("returns false for a workspace owned by the OrganizeOS service account", async () => {
    server.use(
      db.get("WorkspaceMember", () =>
        json([memberRow("ws-org", "svc-owner-1", "Feel Test Signup Org")])
      ),
      // The synthetic org owner is not a billing entity: exempt from the
      // seat check even though it has no products (default free plan).
      db.get("User", () =>
        json([{ id: "svc-owner-1", provider: "organizeos-service" }])
      ),
      db.get("UserProduct", () => json([]))
    );

    const result = await resolveTopics(
      ["seatSuspended"],
      createContext("user-1")
    );
    expect(result.seatSuspended).toBe(false);
  });

  test("still flags a human-owned free workspace when a service-owned one is also present", async () => {
    server.use(
      db.get("WorkspaceMember", () =>
        json([
          memberRow("ws-org", "svc-owner-1", "Feel Test Signup Org"),
          memberRow("ws-human", "owner-1", "Human Workspace"),
        ])
      ),
      db.get("User", () =>
        json([
          { id: "svc-owner-1", provider: "organizeos-service" },
          { id: "owner-1", provider: "google" },
        ])
      ),
      db.get("UserProduct", () => json([]))
    );

    const result = await resolveTopics(
      ["seatSuspended"],
      createContext("user-1")
    );
    expect(result.seatSuspended).toBe("Human Workspace");
  });

  test("keeps the seat check (fail-safe) when the owner-provider lookup errors", async () => {
    server.use(
      db.get("WorkspaceMember", () =>
        json([memberRow("ws-owner", "owner-1", "Owner Workspace")])
      ),
      // Provider lookup fails → owner stays in the check → still suspended.
      db.get("User", () => json({ message: "boom" }, { status: 500 })),
      db.get("UserProduct", () => json([]))
    );

    const result = await resolveTopics(
      ["seatSuspended"],
      createContext("user-1")
    );
    expect(result.seatSuspended).toBe("Owner Workspace");
  });

  test("returns false when owner has upgraded plan (maxWorkspaces > 1)", async () => {
    process.env.PLANS = JSON.stringify([
      { name: "Pro", features: { maxWorkspaces: 5 } },
    ]);

    server.use(
      db.get("WorkspaceMember", () =>
        json([memberRow("ws-owner", "owner-1", "Owner Workspace")])
      ),
      db.get("User", () => json([{ id: "owner-1", provider: "github" }])),
      db.get("UserProduct", () =>
        json([
          { userId: "owner-1", productId: "prod-pro", subscriptionId: null },
        ])
      ),
      db.get("Product", () => json([{ id: "prod-pro", name: "Pro", meta: {} }]))
    );

    const result = await resolveTopics(
      ["seatSuspended"],
      createContext("user-1")
    );
    expect(result.seatSuspended).toBe(false);
  });
});
