import { planUpgradeHint } from "~/shared/branding";

export const SEAT_SUSPENDED_TOAST_ID = "seat-suspended";

/**
 * OrganizeOS fork: upstream described its own seat-billing model ("the owner's
 * plan doesn't include enough seats... add more seats"), which an OrganizeOS
 * admin can neither see nor act on. Org-owned workspaces are exempt from this
 * check server-side (see shared/polly/topic-resolvers.server.ts), so this only
 * fires for a human-owned workspace; keep it accurate but plan-model-neutral.
 */
export const getSeatSuspendedMessage = (workspaceName: string) =>
  `Your editing access to "${workspaceName}" has been paused because the workspace owner's plan no longer covers it. ${planUpgradeHint}`;
