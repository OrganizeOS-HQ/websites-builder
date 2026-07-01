import { createHash } from "node:crypto";
import type { AppContext } from "@webstudio-is/trpc-interface/index.server";
import { createBuild } from "@webstudio-is/project-build/index.server";

/**
 * OrganizeOS multi-tenant provisioning (Websites 2.0, Phase 4b).
 *
 * Each OrganizeOS organization maps 1:1 to a Webstudio Workspace + Project,
 * OWNED by a synthetic service account (User.provider = 'organizeos-service').
 * Human org admins join as non-owner WorkspaceMembers. Ownership stays with the
 * synthetic account so removing a human revokes all their access, and the
 * seat-plan downgrade gate is bypassed for service-owned workspaces (see
 * isServiceOwnedProject in trpc-interface).
 *
 * All ids are derived DETERMINISTICALLY from the organizationId via uuidv5, so
 * provisioning is idempotent: re-running converges instead of duplicating, and
 * an internal route never needs to accept a client-supplied projectId (which
 * would be a cross-tenant takeover vector). The route passes organizationId
 * ONLY; everything else is derived here, server-side.
 */

// Fixed namespace for OrganizeOS org-derived ids. Do not change: it would
// repoint every org to a different Workspace/Project.
const ORG_NAMESPACE = "7b5a9e44-2c4d-5f1a-9c3e-0a1b2c3d4e5f";

const SERVICE_PROVIDER = "organizeos-service";

/** RFC 4122 v5 (SHA-1, namespaced) UUID — deterministic per (namespace, name). */
const uuidV5 = (name: string, namespace: string): string => {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const bytes = createHash("sha1")
    .update(namespaceBytes)
    .update(Buffer.from(name, "utf8"))
    .digest()
    .subarray(0, 16);
  // Set version (5) and the RFC 4122 variant.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

export const deriveSyntheticUserId = (organizationId: string): string =>
  uuidV5(`user:${organizationId}`, ORG_NAMESPACE);

export const deriveWorkspaceId = (organizationId: string): string =>
  uuidV5(`workspace:${organizationId}`, ORG_NAMESPACE);

export const deriveProjectId = (organizationId: string): string =>
  uuidV5(`project:${organizationId}`, ORG_NAMESPACE);

export const deriveSyntheticEmail = (organizationId: string): string =>
  `org+${organizationId}@svc.organizeos.internal`;

/**
 * Webstudio Project.domain must be unique and is only an internal identifier
 * here (public hosting is via the OrganizeOS subdomain + reverse proxy, not
 * Webstudio's domain). Derive a stable, unique slug from the org id.
 */
export const deriveProjectDomain = (organizationId: string): string =>
  `org-${organizationId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

export type ProvisionResult = {
  serviceUserId: string;
  workspaceId: string;
  projectId: string;
};

/**
 * Idempotently provision (or re-sync) an org's Workspace + Project + admin
 * membership. `adminUserIds` are the Webstudio User ids of the org's human
 * admins (the caller resolves these from the ledger's active membership — the
 * provisioning route must NOT trust a client-supplied admin list).
 */
export const provisionOrgWorkspace = async (
  context: AppContext,
  {
    organizationId,
    orgName,
    adminUserIds,
  }: { organizationId: string; orgName: string; adminUserIds: string[] }
): Promise<ProvisionResult> => {
  const client = context.postgrest.client;

  const serviceUserId = deriveSyntheticUserId(organizationId);
  const workspaceId = deriveWorkspaceId(organizationId);
  const projectId = deriveProjectId(organizationId);

  // 1. Synthetic service owner (provider marks it as org-owned + always-licensed).
  const userResult = await client.from("User").upsert(
    {
      id: serviceUserId,
      email: deriveSyntheticEmail(organizationId),
      provider: SERVICE_PROVIDER,
    },
    { onConflict: "id", ignoreDuplicates: true }
  );
  if (userResult.error) {
    throw userResult.error;
  }

  // 2. Workspace owned by the synthetic account. isDefault=true is safe: the
  //    synthetic account owns exactly one workspace.
  const workspaceResult = await client.from("Workspace").upsert(
    {
      id: workspaceId,
      name: orgName,
      isDefault: true,
      userId: serviceUserId,
    },
    { onConflict: "id", ignoreDuplicates: true }
  );
  if (workspaceResult.error) {
    throw workspaceResult.error;
  }

  // 3. Project owned by the synthetic account, in the org's workspace.
  const existingProject = await client
    .from("Project")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (existingProject.error) {
    throw existingProject.error;
  }

  if (existingProject.data === null) {
    // Mirror project.create: insert without owner, create the initial build,
    // then attach owner + workspace so the row is never live without a build.
    const insertProject = await client.from("Project").insert({
      id: projectId,
      title: orgName,
      domain: deriveProjectDomain(organizationId),
    });
    if (insertProject.error) {
      throw insertProject.error;
    }

    await createBuild({ projectId }, context);

    const attachOwner = await client
      .from("Project")
      .update({ userId: serviceUserId, workspaceId })
      .eq("id", projectId);
    if (attachOwner.error) {
      throw attachOwner.error;
    }
  }

  // 4. Human admins as non-owner members (reactivate on re-sync via removedAt).
  if (adminUserIds.length > 0) {
    const memberResult = await client.from("WorkspaceMember").upsert(
      adminUserIds.map((userId) => ({
        workspaceId,
        userId,
        relation: "administrators" as const,
        removedAt: null,
      })),
      { onConflict: "workspaceId,userId" }
    );
    if (memberResult.error) {
      throw memberResult.error;
    }
  }

  return { serviceUserId, workspaceId, projectId };
};

/**
 * Soft-deprovision: hide the org's Workspace + Project and deactivate all
 * members. Never hard-deletes the synthetic User (the deterministic
 * re-derivation anchor) so re-opt-in restores cleanly.
 */
export const deprovisionOrgWorkspace = async (
  context: AppContext,
  { organizationId }: { organizationId: string }
): Promise<void> => {
  const client = context.postgrest.client;
  const workspaceId = deriveWorkspaceId(organizationId);
  const projectId = deriveProjectId(organizationId);

  const projectResult = await client
    .from("Project")
    .update({ isDeleted: true })
    .eq("id", projectId);
  if (projectResult.error) {
    throw projectResult.error;
  }

  const workspaceResult = await client
    .from("Workspace")
    .update({ isDeleted: true })
    .eq("id", workspaceId);
  if (workspaceResult.error) {
    throw workspaceResult.error;
  }

  const membersResult = await client
    .from("WorkspaceMember")
    .update({ removedAt: new Date().toISOString() })
    .eq("workspaceId", workspaceId)
    .is("removedAt", null);
  if (membersResult.error) {
    throw membersResult.error;
  }
};
