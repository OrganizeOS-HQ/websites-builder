import { describe, test, expect } from "vitest";
import {
  createTestServer,
  db,
  testContext,
  empty,
} from "@webstudio-is/postgrest/testing";
import type { AppContext } from "@webstudio-is/trpc-interface/index.server";
import {
  ORGANIZEOS_PLAN_NAME,
  defaultOrgEntitlements,
  entitlementEventData,
  entitlementEventId,
  entitlementProductId,
  entitlementProductMeta,
  syncOrgOwnerPlan,
} from "./organizeos-plan.server";

const server = createTestServer();

const createContext = (): AppContext => testContext as unknown as AppContext;

/**
 * Register the two writes plus the stale-row cleanup, capturing what was sent.
 */
const captureWrites = () => {
  const captured: {
    product?: Record<string, unknown>;
    purchase?: Record<string, unknown>;
    deleteUrl?: string;
  } = {};
  server.use(
    db.post("Product", async ({ request }) => {
      captured.product = (await request.json()) as Record<string, unknown>;
      return empty({ status: 201 });
    }),
    db.post("TransactionLog", async ({ request }) => {
      captured.purchase = (await request.json()) as Record<string, unknown>;
      return empty({ status: 201 });
    }),
    db.delete("TransactionLog", ({ request }) => {
      captured.deleteUrl = request.url;
      return empty({ status: 204 });
    })
  );
  return captured;
};

describe("entitlement plan mapping", () => {
  test("collections entitlement drives allowDynamicData", () => {
    expect(entitlementProductMeta({ collections: true })).toEqual({
      allowDynamicData: true,
    });
    expect(entitlementProductMeta({ collections: false })).toEqual({
      allowDynamicData: false,
    });
  });

  test("no entitlement by default", () => {
    expect(defaultOrgEntitlements.collections).toBe(false);
  });

  test("one shared product per entitlement combination", () => {
    expect(entitlementProductId({ collections: true })).not.toBe(
      entitlementProductId({ collections: false })
    );
    // Stable across orgs, so the plans product cache stays effective.
    expect(entitlementProductId({ collections: true })).toBe(
      entitlementProductId({ collections: true })
    );
  });

  test("purchase row is one per owner and deterministic", () => {
    expect(entitlementEventId("user-1")).toBe(entitlementEventId("user-1"));
    expect(entitlementEventId("user-1")).not.toBe(entitlementEventId("user-2"));
  });

  test("event payload satisfies the UserProduct view's generated columns", () => {
    const eventData = entitlementEventData(1_700_000_000_000);
    // eventType, status and eventCreated are generated out of this JSON.
    expect(eventData.type).toBe("checkout.session.completed");
    expect(eventData.data.object.status).toBe("complete");
    expect(eventData.created).toBe(1_700_000_000);
  });
});

describe("syncOrgOwnerPlan", () => {
  test("grants the org plan with collections enabled", async () => {
    const captured = captureWrites();

    await syncOrgOwnerPlan(createContext(), {
      serviceUserId: "svc-1",
      entitlements: { collections: true },
    });

    // The plan name resolves the baseline features from the PLANS env; meta
    // carries only the per-org entitlement delta.
    expect(captured.product).toMatchObject({
      id: entitlementProductId({ collections: true }),
      name: ORGANIZEOS_PLAN_NAME,
      meta: { allowDynamicData: true },
    });
    expect(captured.purchase).toMatchObject({
      eventId: entitlementEventId("svc-1"),
      userId: "svc-1",
      productId: entitlementProductId({ collections: true }),
    });
  });

  test("grants the org plan with collections withheld", async () => {
    const captured = captureWrites();

    await syncOrgOwnerPlan(createContext(), {
      serviceUserId: "svc-1",
      entitlements: { collections: false },
    });

    expect(captured.product).toMatchObject({
      id: entitlementProductId({ collections: false }),
      meta: { allowDynamicData: false },
    });
    expect(captured.purchase).toMatchObject({
      productId: entitlementProductId({ collections: false }),
    });
  });

  test("removes the owner's other plan rows so a downgrade takes effect", async () => {
    const captured = captureWrites();

    await syncOrgOwnerPlan(createContext(), {
      serviceUserId: "svc-1",
      entitlements: { collections: false },
    });

    // Scoped to this service owner, and never deletes the row just written.
    expect(captured.deleteUrl).toContain("userId=eq.svc-1");
    expect(captured.deleteUrl).toContain(
      `eventId=neq.${entitlementEventId("svc-1")}`
    );
  });

  test("propagates a write failure instead of leaving a silent free tier", async () => {
    server.use(
      db.post("Product", () => empty({ status: 500 })),
      db.post("TransactionLog", () => empty({ status: 201 })),
      db.delete("TransactionLog", () => empty({ status: 204 }))
    );

    await expect(
      syncOrgOwnerPlan(createContext(), {
        serviceUserId: "svc-1",
        entitlements: { collections: true },
      })
    ).rejects.toBeDefined();
  });
});
