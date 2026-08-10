import type { AppContext } from "@webstudio-is/trpc-interface/index.server";

/**
 * OrganizeOS per-org entitlements (Websites 2.0).
 *
 * An org's workspace is owned by a synthetic service account, which has no
 * Stripe subscription. Without a plan row that owner resolves to
 * `defaultPlanFeatures` (the free tier), so every provisioned org ran on free
 * limits regardless of what it pays OrganizeOS for.
 *
 * This module gives the synthetic owner a real plan the same way the rest of
 * the builder reads one: a `Product` row plus a `TransactionLog` row that
 * satisfies the `UserProduct` view. Nothing else has to know about OrganizeOS
 * entitlements — `getPlanInfo` resolves them naturally for every consumer
 * (builder permissions, publish limits, seat checks, restricted features).
 * That matters: the seat-suspension bug (PR #8) came from a gate that
 * re-derived plan state on its own, and every such derivation is fed from here.
 *
 * Feature VALUES come from the `organizeos` entry of the `PLANS` env, so the
 * baseline stays configuration. `Product.meta` carries only the per-org
 * entitlement delta, which is what OrganizeOS actually owns.
 */

/** Must match a plan name in the builder's `PLANS` env. */
export const ORGANIZEOS_PLAN_NAME = "organizeos";

/**
 * Entitlements OrganizeOS resolves per org and passes at provision time.
 * `collections` is the `webstudio_collections` capability (Scale and up):
 * binding external data — Resource variables and the Collection element.
 */
export type OrgEntitlements = {
  collections: boolean;
};

/** Deny by default: an omitted entitlement never grants a paid feature. */
export const defaultOrgEntitlements: OrgEntitlements = {
  collections: false,
};

/**
 * One shared Product per entitlement combination (NOT one per org), so the
 * process-lifetime product cache in @webstudio-is/plans stays effective.
 */
export const entitlementProductId = (entitlements: OrgEntitlements): string =>
  entitlements.collections
    ? "organizeos-plan-collections"
    : "organizeos-plan-standard";

/**
 * The entitlement delta layered over the named plan's features
 * (`parseProductMeta` in @webstudio-is/plans merges meta on top of the plan).
 * Only keys OrganizeOS gates per org belong here; everything else stays with
 * the `PLANS` env so it can be tuned without a deploy.
 */
export const entitlementProductMeta = (
  entitlements: OrgEntitlements
): Record<string, boolean> => ({
  allowDynamicData: entitlements.collections,
});

/** Deterministic, one row per service owner, so a re-sync updates in place. */
export const entitlementEventId = (serviceUserId: string): string =>
  `organizeos-plan-${serviceUserId}`;

/**
 * The UserProduct view only surfaces completed checkout events, so the event
 * payload has to look like one: `eventType`, `status` and `eventCreated` are
 * generated columns read out of this JSON.
 */
export const entitlementEventData = (nowMs: number) => ({
  type: "checkout.session.completed",
  created: Math.floor(nowMs / 1000),
  data: { object: { status: "complete" } },
});

/**
 * Give an org's synthetic owner the OrganizeOS plan matching its entitlements.
 * Idempotent: re-running with different entitlements repoints the owner's
 * single plan row, so an upgrade or a downgrade both converge.
 */
export const syncOrgOwnerPlan = async (
  context: AppContext,
  {
    serviceUserId,
    entitlements,
  }: { serviceUserId: string; entitlements: OrgEntitlements }
): Promise<void> => {
  const client = context.postgrest.client;
  const productId = entitlementProductId(entitlements);

  const productResult = await client.from("Product").upsert({
    id: productId,
    name: ORGANIZEOS_PLAN_NAME,
    meta: entitlementProductMeta(entitlements),
    features: [],
    images: [],
  });
  if (productResult.error) {
    throw productResult.error;
  }

  const eventId = entitlementEventId(serviceUserId);
  const purchaseResult = await client.from("TransactionLog").upsert({
    eventId,
    userId: serviceUserId,
    productId,
    eventData: entitlementEventData(Date.now()),
  });
  if (purchaseResult.error) {
    throw purchaseResult.error;
  }

  // getPlanInfo ORs the features of every product a user holds, so a leftover
  // row would make a downgrade a no-op. Keep exactly one row per service owner.
  const staleResult = await client
    .from("TransactionLog")
    .delete()
    .eq("userId", serviceUserId)
    .neq("eventId", eventId);
  if (staleResult.error) {
    throw staleResult.error;
  }
};
