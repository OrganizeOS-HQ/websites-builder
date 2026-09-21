import { type ActionFunctionArgs } from "@remix-run/server-runtime";
import { authenticator } from "~/services/auth.server";
import {
  resolveSsoLandingUrl,
  resolveSsoReturnTo,
} from "~/services/auth-strategy/organizeos.server";
import { dashboardPath, isDashboard, loginPath } from "~/shared/router-utils";
import { AUTH_PROVIDERS } from "~/shared/session";
import { clearReturnToCookie, returnToPath } from "~/services/cookie.server";
import { preventCrossOriginCookie } from "~/services/no-cross-origin-cookie";
import { redirect, setNoStoreToRedirect } from "~/services/no-store-redirect";

/**
 * OrganizeOS SSO entry route (Websites 2.0 Phase 4c).
 *
 * The OrganizeOS app POSTs a short-lived, single-use trust token here (in the
 * body, never a query string, so the bearer never lands in access logs or
 * history). The `organizeos` dashboard strategy verifies + consumes it and
 * establishes the standard dashboard session, then we redirect into the
 * dashboard.
 *
 * Unlike the OAuth routes, this endpoint EXISTS to receive a cross-site POST
 * (the OrganizeOS app is a different origin), so the cross-origin guard runs
 * in strip-cookies-only mode rather than throwing: ambient credentials are
 * still discarded, and the actual CSRF/forgery defense is the signed,
 * audience-bound, single-use, short-exp token whose `sub` is bound to the
 * admin, so the session can only ever land in that admin's own dashboard.
 */
export default function OrganizeosSso() {
  return null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (false === isDashboard(request)) {
    throw new Response("Not Found", { status: 404 });
  }

  // Strip cookies but do not throw: this route is a deliberate cross-site
  // POST, and it authenticates by the token in the body, never by cookies.
  preventCrossOriginCookie(request, false);

  // Land directly in the org's project builder (the org has exactly one
  // project, derived from the token's organizationId), skipping the fork
  // dashboard: the OrganizeOS Website area is the management surface.
  //
  // Note the stored returnTo is always absent in practice: the cookie header
  // was deleted above, so returnToPath finds nothing on a real entry. The
  // resolveSsoReturnTo call is kept as the second lock -- it is what stops a
  // /dashboard returnTo outranking the deep link if that strip ever stops
  // happening -- but it is not what makes the deep link win today.
  // Clone the request: the authenticator consumes the original body.
  const token = (await request.clone().formData()).get("token");
  const deepLink =
    typeof token === "string"
      ? resolveSsoLandingUrl(token, new URL(request.url).origin)
      : null;
  const returnTo = resolveSsoReturnTo({
    storedReturnTo: await returnToPath(request),
    deepLink,
    dashboardPath: dashboardPath(),
  });

  try {
    return await authenticator.authenticate("organizeos", request, {
      successRedirect: returnTo,
      throwOnError: true,
    });
  } catch (error) {
    // Redirects are thrown as Responses; re-surface them unchanged.
    if (error instanceof Response) {
      return setNoStoreToRedirect(await clearReturnToCookie(request, error));
    }

    // Do not echo the failure reason (it distinguishes verify failures from
    // replay from ledger errors). Send to a generic login error.
    console.error({
      error,
      extras: { loginMethod: AUTH_PROVIDERS.LOGIN_ORGANIZEOS },
    });

    return redirect(
      loginPath({
        error: AUTH_PROVIDERS.LOGIN_ORGANIZEOS,
        message: "Could not sign in from OrganizeOS. Please try again.",
        returnTo,
      })
    );
  }
};
