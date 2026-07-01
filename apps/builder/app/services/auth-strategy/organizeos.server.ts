import type { AppContext } from "@webstudio-is/trpc-interface/index.server";
import { resolveOrCreateUserByEmail } from "~/shared/db/user.server";
import { verifyOrganizeosSsoToken } from "./organizeos-token.server";

/**
 * OrganizeOS SSO login (Websites 2.0 Phase 4c).
 *
 * Verifies an OrganizeOS trust token, enforces single-use, and resolves the
 * admin to a Webstudio dashboard User. Returns the session payload for the
 * `organizeos` dashboard strategy. Any failure throws (the strategy denies).
 *
 * Trust model: OrganizeOS is the sole trust root for admin membership and email
 * verification. It signs a token only for a currently-active org admin, so the
 * fork trusts the signed `email`/`organizationId` claims after verifying the
 * signature, the audience/issuer, a short exp window, and single-use. The
 * builder OAuth/PKCE seam still re-decides per-project access via
 * checkProjectPermit against real WorkspaceMember rows, so a valid SSO session
 * alone grants nothing beyond the org's own workspace.
 */

// The shared, atomic single-use store. A unique insert per jti: the first use
// wins, any later use (replay) hits the primary-key conflict and is denied.
// Lives in the OrganizeOS ledger DB (same PostgREST the fork already uses).
const CONSUMED_TOKENS_TABLE = "websites2_sso_consumed_tokens";

/**
 * Consume a token's jti exactly once. Resolves on first use; throws on a replay
 * OR on any store error (fail closed: if single-use cannot be guaranteed, deny).
 */
export const consumeSsoJti = async (
  context: AppContext,
  jti: string
): Promise<void> => {
  // The consumed-tokens table lives in the OrganizeOS ledger schema, which the
  // fork's typed PostgREST client does not know about, so narrow the client to
  // a minimal insert shape for this one cross-schema write.
  const client = context.postgrest.client as unknown as {
    from: (table: string) => {
      insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
    };
  };
  const result = await client.from(CONSUMED_TOKENS_TABLE).insert({ jti });

  if (result.error) {
    // A unique-violation means the jti was already used (replay). Any other
    // error means we cannot confirm single-use, so we also deny. Either way the
    // token is rejected; we do not distinguish in the thrown message.
    throw new Error(
      "SSO token has already been used or could not be validated"
    );
  }
};

export const organizeosSsoLogin = async (
  context: AppContext,
  token: string,
  publicKeyPem: string
): Promise<{ userId: string; createdAt: number }> => {
  // 1. Verify signature + algorithm + issuer/audience + exp window + required
  //    claims BEFORE any I/O. Throws on anything unexpected.
  const claims = verifyOrganizeosSsoToken(token, publicKeyPem);

  // 2. Enforce single-use. Only after the token is proven authentic so an
  //    attacker cannot burn arbitrary nonces with an unsigned token.
  await consumeSsoJti(context, claims.jti);

  // 3. Resolve (or lazily create) the Webstudio dashboard User for this admin.
  const user = await resolveOrCreateUserByEmail(context, claims.email);

  return { userId: user.id, createdAt: Date.now() };
};
