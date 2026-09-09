import { timingSafeEqual } from "node:crypto";

/**
 * Shared guard for the OrganizeOS server-to-server routes (provisioning,
 * publish status). Every internal route authenticates the same way: a raw
 * shared secret in the Authorization header (no "Bearer" prefix), compared in
 * constant time, and a hard rejection of any request that carries a session
 * cookie so a browser or CSRF context can never reach these endpoints.
 */

export const constantTimeEqual = (a: string, b: string): boolean => {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  // timingSafeEqual requires equal-length buffers; the length itself is not
  // secret, so compare lengths first then constant-time compare the bytes.
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
};

/**
 * True only when `expectedToken` is configured (an unset secret disables the
 * route rather than opening it), the request carries no Cookie header, and the
 * Authorization header equals the token byte-for-byte.
 */
export const isAuthorizedInternalCall = (
  request: Request,
  expectedToken: string | undefined
): boolean => {
  if (expectedToken === undefined || expectedToken.length === 0) {
    return false;
  }
  if (request.headers.get("Cookie") !== null) {
    return false;
  }
  const header = request.headers.get("Authorization");
  if (header === null) {
    return false;
  }
  return constantTimeEqual(header, expectedToken);
};
