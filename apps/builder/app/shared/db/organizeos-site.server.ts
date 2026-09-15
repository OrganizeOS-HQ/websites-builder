import { z } from "zod";
import type { AppContext } from "@webstudio-is/trpc-interface/index.server";
import { ORGANIZEOS_SERVICE_PROVIDER } from "@webstudio-is/trpc-interface/index.server";
import type { OrganizeosSite } from "../organizeos-site";
import { parseOrganizationIdFromServiceEmail } from "~/services/organizeos-publisher.server";

/**
 * The org's site identity inside the builder (Websites 2.0).
 *
 * An org's project is reached from OrganizeOS and published back to it, but
 * the builder used to know nothing about where the site actually lives: the
 * project's domain was an opaque org-<id> placeholder and every address the
 * UI showed was <placeholder>.wstd.work. OrganizeOS now tells the builder the
 * org's platform subdomain (at provisioning and again on every SSO entry, so a
 * rename converges), and it is mirrored into Project.domain. With
 * PUBLISHER_HOST set to the platform base domain, everything upstream renders
 * as "the site's address" (Publish dialog, address bar, dashboard card) is the
 * real public URL, with no per-surface patches.
 */

/**
 * Same shape OrganizeOS enforces for an org slug (`ORG_SLUG_RE`): lowercase
 * alphanumerics with internal hyphens, at most 63 characters. Anything else is
 * treated as absent, never written.
 */
export const ORG_SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const orgSubdomainSchema = z.string().regex(ORG_SUBDOMAIN_PATTERN);

export const isOrgSubdomain = (value: unknown): value is string =>
  typeof value === "string" && ORG_SUBDOMAIN_PATTERN.test(value);

/**
 * Webstudio Project.domain must be unique and, without a subdomain, is only an
 * internal identifier (public hosting is via the OrganizeOS subdomain + reverse
 * proxy). Derive a stable, unique placeholder from the org id.
 */
export const deriveProjectDomain = (organizationId: string): string =>
  `org-${organizationId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/** The domain an org's project should carry: its subdomain, else the placeholder. */
export const resolveOrgProjectDomain = (
  organizationId: string,
  subdomain: string | undefined
): string =>
  isOrgSubdomain(subdomain) ? subdomain : deriveProjectDomain(organizationId);

/**
 * Point Project.domain at the org's current subdomain. Idempotent; a no-op
 * when the project already carries it or when no subdomain is known (never
 * overwrites a real subdomain with the placeholder). A domain already taken by
 * another project is reported rather than thrown: the org keeps working on its
 * previous domain and the collision is logged for an operator.
 */
export const syncOrgProjectDomain = async (
  context: AppContext,
  {
    projectId,
    organizationId,
    subdomain,
  }: {
    projectId: string;
    organizationId: string;
    subdomain: string | undefined;
  }
): Promise<{ domain: string; changed: boolean; conflict: boolean }> => {
  const client = context.postgrest.client;

  const current = await client
    .from("Project")
    .select("domain")
    .eq("id", projectId)
    .maybeSingle();
  if (current.error) {
    throw current.error;
  }
  if (current.data === null) {
    throw new Error(`Project ${projectId} not found`);
  }

  const target = isOrgSubdomain(subdomain)
    ? subdomain
    : deriveProjectDomain(organizationId);

  // Only a known subdomain moves the domain; an absent one leaves whatever the
  // project carries (subdomain or placeholder) alone.
  if (current.data.domain === target || isOrgSubdomain(subdomain) === false) {
    return { domain: current.data.domain, changed: false, conflict: false };
  }

  const update = await client
    .from("Project")
    .update({ domain: target })
    .eq("id", projectId);
  if (update.error) {
    if (update.error.code === "23505") {
      console.warn(
        `[organizeos-site] domain "${target}" is taken by another project; org ${organizationId} keeps "${current.data.domain}"`
      );
      return { domain: current.data.domain, changed: false, conflict: true };
    }
    throw update.error;
  }

  return { domain: target, changed: true, conflict: false };
};

/** The org's Website area in OrganizeOS, on the app host (app.<base>/<org>/website). */
export const organizeosWebsiteAreaUrl = (
  platformUrl: string,
  subdomain: string | undefined
): string => {
  const base = platformUrl.replace(/\/+$/, "");
  return subdomain === undefined
    ? `${base}/dashboard`
    : `${base}/${subdomain}/website`;
};

/**
 * Describe the OrganizeOS org behind a project, or undefined for a project a
 * human owns (which is not an OrganizeOS site and gets upstream behavior).
 * Pure: the caller supplies the project's owner row and the deployment's
 * publisher host + platform URL.
 */
export const resolveOrganizeosSite = ({
  owner,
  projectDomain,
  publisherHost,
  platformUrl,
}: {
  owner: { provider: string | null; email: string | null };
  projectDomain: string;
  publisherHost: string;
  platformUrl: string;
}): OrganizeosSite | undefined => {
  if (owner.provider !== ORGANIZEOS_SERVICE_PROVIDER || owner.email === null) {
    return undefined;
  }
  const organizationId = parseOrganizationIdFromServiceEmail(owner.email);
  if (organizationId === null) {
    return undefined;
  }
  // The placeholder means OrganizeOS never told us the subdomain; anything
  // else is the subdomain it mirrored in.
  const subdomain =
    projectDomain !== deriveProjectDomain(organizationId) &&
    isOrgSubdomain(projectDomain)
      ? projectDomain
      : undefined;

  return {
    organizationId,
    subdomain,
    siteUrl:
      subdomain === undefined
        ? undefined
        : `https://${subdomain}.${publisherHost}`,
    manageUrl: organizeosWebsiteAreaUrl(platformUrl, subdomain),
    platformUrl: platformUrl.replace(/\/+$/, ""),
  };
};

/** The slice of a dashboard workspace row this module needs. */
export type DashboardWorkspace = {
  id: string;
  /** The workspace OWNER's user id; an org workspace is owned by its service account. */
  userId: string;
  /** The signed-in user's relation to it; "own" means they own it. */
  role: string;
};

/**
 * Where to send a signed-in user who has landed on the fork dashboard, or
 * undefined to let them see it.
 *
 * The dashboard is upstream's personal-account surface and OrganizeOS does not
 * use it: SSO deep-links an admin straight into their org's project, and the
 * builder menu sends them back to OrganizeOS. What is left is upstream-shaped
 * in ways that are wrong for an org admin (their org's workspace is listed
 * under "Shared with me", below an empty personal workspace that opens by
 * default) and in ways that are dangerous (New project, Duplicate and Transfer
 * act on a project whose identity OrganizeOS derives, and Leave drops the
 * admin's own access).
 *
 * An admin is identified from data rather than from a session flag: they are a
 * non-owner member of a workspace owned by an `organizeos-service` account.
 * A user who ALSO owns projects here keeps the dashboard, because it is the
 * only way to reach them - this sends back only the users whose entire
 * presence in the builder is their organization's site.
 */
export const resolveOrganizeosDashboardExit = async (
  context: AppContext,
  {
    userId,
    workspaces,
    publisherHost,
    platformUrl,
  }: {
    userId: string;
    workspaces: ReadonlyArray<DashboardWorkspace>;
    publisherHost: string;
    platformUrl: string;
  }
): Promise<string | undefined> => {
  const client = context.postgrest.client;
  const home = platformUrl.replace(/\/+$/, "");

  const memberWorkspaces = workspaces.filter(
    (workspace) => workspace.role !== "own"
  );
  if (memberWorkspaces.length === 0) {
    return undefined;
  }

  const owners = await client
    .from("User")
    .select("id, provider, email")
    .in("id", [
      ...new Set(memberWorkspaces.map((workspace) => workspace.userId)),
    ])
    .eq("provider", ORGANIZEOS_SERVICE_PROVIDER);
  if (owners.error) {
    throw owners.error;
  }
  const serviceOwners = new Map(owners.data.map((owner) => [owner.id, owner]));
  const orgWorkspaces = memberWorkspaces.filter((workspace) =>
    serviceOwners.has(workspace.userId)
  );
  if (orgWorkspaces.length === 0) {
    return undefined;
  }

  const ownProjects = await client
    .from("Project")
    .select("id", { count: "exact", head: true })
    .eq("userId", userId)
    .eq("isDeleted", false);
  if (ownProjects.error) {
    throw ownProjects.error;
  }
  if ((ownProjects.count ?? 0) > 0) {
    return undefined;
  }

  // An admin of several orgs has no single Website area to land on.
  const orgWorkspace =
    orgWorkspaces.length === 1 ? orgWorkspaces[0] : undefined;
  if (orgWorkspace === undefined) {
    return home;
  }

  const owner = serviceOwners.get(orgWorkspace.userId);
  const project = await client
    .from("Project")
    .select("domain")
    .eq("workspaceId", orgWorkspace.id)
    .eq("isDeleted", false)
    .limit(1)
    .maybeSingle();
  if (project.error) {
    throw project.error;
  }
  if (owner === undefined || project.data === null) {
    return home;
  }

  return (
    resolveOrganizeosSite({
      owner,
      projectDomain: project.data.domain,
      publisherHost,
      platformUrl,
    })?.manageUrl ?? home
  );
};
