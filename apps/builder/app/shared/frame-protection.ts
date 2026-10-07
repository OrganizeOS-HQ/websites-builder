/**
 * Keeps other pages from framing the builder or the canvas (clickjacking).
 *
 * Session cookies are scoped to .organizeos.org and org sites live on
 * {org}.organizeos.org, so an org's page is same-site with
 * builder.organizeos.org and p-<projectId>.builder.organizeos.org. SameSite
 * cookies are still sent for a same-site frame, so such a page could frame the
 * builder or the canvas with a signed-in admin's session and click through it.
 *
 * The canvas iframe is same-origin with the builder UI (getCanvasUrl() is the
 * relative /canvas) and nothing else legitimately frames either of them, so
 * 'self' is right everywhere. X-Frame-Options covers browsers without
 * frame-ancestors; a browser that knows both uses frame-ancestors.
 *
 * root.tsx sends these for every document. Remix replaces the parent's headers
 * (keeping only Set-Cookie) when a route exports `headers`, so such a route
 * has to merge them itself. frame-protection-routes.server.test.ts fails if
 * one does not.
 *
 * No imports: root.tsx is part of the client bundle too.
 */

export const FRAME_ANCESTORS = "frame-ancestors 'self'";

// Frozen because every response shares this object.
export const frameProtectionHeaders = Object.freeze({
  "Content-Security-Policy": FRAME_ANCESTORS,
  "X-Frame-Options": "SAMEORIGIN",
});

/**
 * Adds frame-ancestors to a Content-Security-Policy that carries other
 * directives (a route that sets its own policy), so that one response never
 * has two policies. A policy that already has the directive keeps its own
 * value: a browser would ignore a repeated directive anyway.
 */
export const withFrameAncestors = (csp: string | null | undefined): string => {
  const policy = (csp ?? "").trim().replace(/[;\s]+$/, "");

  if (policy === "") {
    return FRAME_ANCESTORS;
  }

  const hasFrameAncestors = policy
    .split(";")
    .some(
      (directive) =>
        directive.trim().split(/\s+/, 1)[0].toLowerCase() === "frame-ancestors"
    );

  return hasFrameAncestors ? policy : `${policy}; ${FRAME_ANCESTORS}`;
};
