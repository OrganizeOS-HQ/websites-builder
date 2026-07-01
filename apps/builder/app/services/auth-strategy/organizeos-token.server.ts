import { createPublicKey, verify as cryptoVerify } from "node:crypto";

/**
 * OrganizeOS SSO trust-token verifier (Websites 2.0 Phase 4c).
 *
 * OrganizeOS signs a short-lived, single-use token for a verified active admin
 * and navigates them to the builder's SSO entry route. This module verifies
 * that token. It is the security boundary between the two systems, so it is
 * deliberately strict and dependency-free (Node crypto only).
 *
 * Hardening (per the Phase 4 red-team):
 *  - ALGORITHM IS HARD-PINNED to ES256. The token is asymmetric (OrganizeOS
 *    holds the private key, the fork holds only the public key). Accepting any
 *    other alg is the classic forgery vector: with `alg:none` the signature is
 *    skipped, and with a symmetric alg (HS256) the public key becomes the HMAC
 *    secret, so anyone who knows the public key can forge a token. We reject
 *    everything except ES256 before touching the signature.
 *  - exp is REQUIRED, numeric, and must fall within (now, now+maxWindow]. An
 *    absent/zero exp is not treated as "never expires".
 *  - Every claim the caller relies on (iss, aud, sub, email, organizationId,
 *    jti) must be present and non-empty.
 *
 * Single-use (jti) enforcement and the email -> user resolution happen in the
 * strategy, not here; this module is pure verification of one token.
 */

export type OrganizeosSsoClaims = {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  organizationId: string;
  exp: number;
  iat?: number;
  jti: string;
};

const EXPECTED_ALG = "ES256";
const EXPECTED_ISS = "organizeos";
const EXPECTED_AUD = "webstudio-dashboard";
// Reject tokens whose exp is further than this beyond now: bounds the lifetime
// even if the issuer sets a long exp, and tolerates minor clock skew.
const DEFAULT_MAX_WINDOW_SECONDS = 90;

const decodeSegment = (segment: string): unknown => {
  const json = Buffer.from(segment, "base64url").toString("utf8");
  return JSON.parse(json);
};

/**
 * Verify an OrganizeOS SSO token against the configured public key. Returns the
 * validated claims or throws. Never trusts any field before the signature and
 * algorithm are confirmed.
 */
export const verifyOrganizeosSsoToken = (
  token: string,
  publicKeyPem: string,
  options?: { now?: number; maxWindowSeconds?: number }
): OrganizeosSsoClaims => {
  const nowSeconds = Math.floor((options?.now ?? Date.now()) / 1000);
  const maxWindowSeconds =
    options?.maxWindowSeconds ?? DEFAULT_MAX_WINDOW_SECONDS;

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed SSO token");
  }
  const [headerSegment, payloadSegment, signatureSegment] = parts;

  const header = decodeSegment(headerSegment) as {
    alg?: unknown;
    typ?: unknown;
  };
  // Hard algorithm pin BEFORE any signature work.
  if (header.alg !== EXPECTED_ALG) {
    throw new Error("Unexpected SSO token algorithm");
  }
  if (header.typ !== undefined && header.typ !== "JWT") {
    throw new Error("Unexpected SSO token type");
  }

  const publicKey = createPublicKey(publicKeyPem);
  const signingInput = Buffer.from(
    `${headerSegment}.${payloadSegment}`,
    "utf8"
  );
  const signature = Buffer.from(signatureSegment, "base64url");
  // ES256 JWT signatures are raw r||s (IEEE P1363), not DER.
  const isValid = cryptoVerify(
    "sha256",
    signingInput,
    { key: publicKey, dsaEncoding: "ieee-p1363" },
    signature
  );
  if (isValid === false) {
    throw new Error("Invalid SSO token signature");
  }

  const payload = decodeSegment(payloadSegment) as Partial<OrganizeosSsoClaims>;

  if (payload.iss !== EXPECTED_ISS) {
    throw new Error("Unexpected SSO token issuer");
  }
  if (payload.aud !== EXPECTED_AUD) {
    throw new Error("Unexpected SSO token audience");
  }
  if (
    typeof payload.exp !== "number" ||
    Number.isFinite(payload.exp) === false
  ) {
    throw new Error("SSO token is missing a valid exp");
  }
  if (payload.exp <= nowSeconds) {
    throw new Error("SSO token has expired");
  }
  if (payload.exp > nowSeconds + maxWindowSeconds) {
    throw new Error("SSO token exp is too far in the future");
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("SSO token is missing sub");
  }
  if (typeof payload.email !== "string" || payload.email.length === 0) {
    throw new Error("SSO token is missing email");
  }
  if (
    typeof payload.organizationId !== "string" ||
    payload.organizationId.length === 0
  ) {
    throw new Error("SSO token is missing organizationId");
  }
  if (typeof payload.jti !== "string" || payload.jti.length === 0) {
    throw new Error("SSO token is missing jti");
  }

  return {
    iss: payload.iss,
    aud: payload.aud,
    sub: payload.sub,
    email: payload.email,
    organizationId: payload.organizationId,
    exp: payload.exp,
    iat: payload.iat,
    jti: payload.jti,
  };
};
