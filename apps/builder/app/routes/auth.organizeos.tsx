import { type ActionFunctionArgs } from "@remix-run/server-runtime";
import { authenticator } from "~/services/auth.server";
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
 * The header guards below mirror auth.github.tsx as defense-in-depth. For a
 * top-level document POST they are largely no-ops; the real CSRF/forgery
 * defense is the signed, audience-bound, single-use, short-exp token whose
 * `sub` is bound to the admin, so the session can only ever land in that
 * admin's own dashboard.
 */
export default function OrganizeosSso() {
  return null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (false === isDashboard(request)) {
    throw new Response("Not Found", { status: 404 });
  }

  preventCrossOriginCookie(request);

  const returnTo = (await returnToPath(request)) ?? dashboardPath();

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
