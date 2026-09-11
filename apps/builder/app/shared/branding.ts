/**
 * OrganizeOS white-label constants.
 *
 * This builder is a fork of Webstudio, but users only ever meet it as part of
 * OrganizeOS. Everything user-visible that named the upstream product, linked
 * to its marketing site, or sold its plans belongs here, so there is one place
 * to change and one place to audit.
 */

/** Product name for tab titles, notifications and blocking alerts. */
export const productName = "OrganizeOS Websites";

/** The platform that owns accounts, plans and support. */
export const platformName = "OrganizeOS";

/**
 * Platform home, used where the builder has to hand a user back to OrganizeOS.
 * The production default; a deployment overrides it with ORGANIZEOS_APP_URL.
 * Server code reads `env.ORGANIZEOS_APP_URL` (which falls back to this) and
 * passes the result down with loader data, so the client never needs the env.
 */
export const platformUrl = "https://app.organizeos.org";

/**
 * The platform base domain an org's published site is served from: a site lives
 * at `<subdomain>.<publisherHost>`. The production default; a deployment
 * overrides it with PUBLISHER_HOST. Upstream defaulted this to its own staging
 * domain, so an unset env made the builder advertise a Webstudio address in the
 * address bar and the Publish dialog.
 */
export const publisherHost = "organizeos.org";

/**
 * Plans are per-org entitlements resolved by OrganizeOS (see
 * `shared/db/organizeos-plan.server.ts`), never a checkout inside the builder.
 * So a gated feature points at the org's administrator instead of a payment
 * page — there is nothing a user can buy from here.
 */
export const planUpgradeHint = `Ask your ${platformName} administrator to upgrade your plan.`;

/**
 * Label for the badge that marks a control the org's plan does not include.
 * Upstream said "PRO", naming a Webstudio tier that has no OrganizeOS
 * equivalent and that nobody can buy from inside the builder. The adjacent
 * tooltips carry `planUpgradeHint`, which says who actually does the upgrading.
 */
export const planBadgeLabel = "Upgrade";

/**
 * AGPL section 13 source offer. This is a modified version of Webstudio served
 * over a network, so users interacting with it must be offered the complete
 * corresponding source. The link is deliberately low-key rather than absent:
 * keep it reachable from the app chrome — it is a license obligation, not a
 * marketing link.
 */
export const sourceCodeUrl =
  "https://github.com/OrganizeOS-HQ/websites-builder";

/** Label for the source offer. Neutral on purpose — it is not a product ad. */
export const sourceCodeLabel = "Source code";
