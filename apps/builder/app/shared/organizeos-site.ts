/**
 * What the builder knows about the OrganizeOS org behind a project. Resolved
 * server-side for projects owned by an org's synthetic service account (see
 * shared/db/organizeos-site.server.ts) and handed to the client with the rest
 * of the builder loader data, so the chrome can point back at OrganizeOS and
 * the Publish dialog can show the site's real address instead of upstream's
 * <project>.wstd.work.
 */
export type OrganizeosSite = {
  organizationId: string;
  /**
   * The org's platform subdomain, when OrganizeOS has told the builder what it
   * is (provisioning or SSO). Absent for a project provisioned by an older
   * OrganizeOS, which still knows only the derived placeholder domain.
   */
  subdomain?: string;
  /** Public URL of the org's site (https://<subdomain>.<platform base domain>). */
  siteUrl?: string;
  /** The org's Website area in OrganizeOS: publish state, domains, settings. */
  manageUrl: string;
  /** OrganizeOS app home, for a plain "back to OrganizeOS" affordance. */
  platformUrl: string;
};
