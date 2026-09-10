import { describe, test, expect, vi } from "vitest";
import {
  createTestServer,
  db,
  testContext,
  empty,
  json,
} from "@webstudio-is/postgrest/testing";
import type { AppContext } from "@webstudio-is/trpc-interface/index.server";
import {
  deriveSyntheticUserId,
  deriveWorkspaceId,
  deriveProjectId,
  deriveSyntheticEmail,
  deriveProjectDomain,
  grantOrgWorkspaceMembership,
  provisionOrgWorkspace,
} from "./provision.server";
import { entitlementProductId } from "./organizeos-plan.server";

const UUID_V5 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("provision id derivation", () => {
  test("ids are deterministic per organization", () => {
    expect(deriveSyntheticUserId("org-1")).toBe(deriveSyntheticUserId("org-1"));
    expect(deriveWorkspaceId("org-1")).toBe(deriveWorkspaceId("org-1"));
    expect(deriveProjectId("org-1")).toBe(deriveProjectId("org-1"));
  });

  test("ids differ across organizations", () => {
    expect(deriveWorkspaceId("org-1")).not.toBe(deriveWorkspaceId("org-2"));
    expect(deriveProjectId("org-1")).not.toBe(deriveProjectId("org-2"));
  });

  test("user/workspace/project ids are distinct for the same org", () => {
    const ids = new Set([
      deriveSyntheticUserId("org-1"),
      deriveWorkspaceId("org-1"),
      deriveProjectId("org-1"),
    ]);
    expect(ids.size).toBe(3);
  });

  test("ids are valid RFC 4122 v5 uuids", () => {
    expect(deriveSyntheticUserId("org-xyz")).toMatch(UUID_V5);
    expect(deriveWorkspaceId("org-xyz")).toMatch(UUID_V5);
    expect(deriveProjectId("org-xyz")).toMatch(UUID_V5);
  });

  test("synthetic email + project domain derivations", () => {
    expect(deriveSyntheticEmail("ABC")).toBe("org+ABC@svc.organizeos.internal");
    expect(deriveProjectDomain("Org_X 1")).toBe("org-org-x-1");
  });
});

// A brand-new project gets its first build through project-build's RPC; the
// build itself is not under test here.
vi.mock("@webstudio-is/project-build/index.server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@webstudio-is/project-build/index.server")
  >()),
  createBuild: vi.fn(async () => ({ id: "build-1" })),
}));

const server = createTestServer();

/**
 * Provision an org whose project already exists (so no build is created) and
 * report which product the synthetic owner's plan row points at.
 */
const provisionAndReadPlanProduct = async (entitlements?: {
  collections: boolean;
}): Promise<string | undefined> => {
  let productId: string | undefined;
  server.use(
    db.post("User", () => empty({ status: 201 })),
    db.post("Workspace", () => empty({ status: 201 })),
    db.post("Product", () => empty({ status: 201 })),
    db.post("TransactionLog", async ({ request }) => {
      const body = (await request.json()) as { productId?: string };
      productId = body.productId;
      return empty({ status: 201 });
    }),
    db.delete("TransactionLog", () => empty({ status: 204 })),
    db.get("Project", () => json({ id: deriveProjectId("org-1") }))
  );

  await provisionOrgWorkspace(testContext as unknown as AppContext, {
    organizationId: "org-1",
    orgName: "Org One",
    adminEmails: [],
    ...(entitlements === undefined ? {} : { entitlements }),
  });

  return productId;
};

describe("provisionOrgWorkspace entitlements", () => {
  test("the org's entitlements become the synthetic owner's plan", async () => {
    expect(await provisionAndReadPlanProduct({ collections: true })).toBe(
      entitlementProductId({ collections: true })
    );
  });

  test("a caller that sends no entitlements grants none", async () => {
    expect(await provisionAndReadPlanProduct()).toBe(
      entitlementProductId({ collections: false })
    );
  });
});

/** Provision "org-1" and capture the Project rows written (insert + updates). */
const provisionAndCaptureProject = async ({
  existingProject,
  subdomain,
}: {
  existingProject: Record<string, unknown> | undefined;
  subdomain?: string;
}) => {
  const inserted: Array<Record<string, unknown>> = [];
  const patched: Array<Record<string, unknown>> = [];
  server.use(
    db.post("User", () => empty({ status: 201 })),
    db.post("Workspace", () => empty({ status: 201 })),
    db.post("Product", () => empty({ status: 201 })),
    db.post("TransactionLog", () => empty({ status: 201 })),
    db.delete("TransactionLog", () => empty({ status: 204 })),
    db.get("Project", () =>
      existingProject === undefined ? json([]) : json(existingProject)
    ),
    db.post("Project", async ({ request }) => {
      inserted.push((await request.json()) as Record<string, unknown>);
      return empty({ status: 201 });
    }),
    db.patch("Project", async ({ request }) => {
      patched.push((await request.json()) as Record<string, unknown>);
      return empty({ status: 204 });
    })
  );

  await provisionOrgWorkspace(testContext as unknown as AppContext, {
    organizationId: "org-1",
    orgName: "Org One",
    adminEmails: [],
    ...(subdomain === undefined ? {} : { subdomain }),
  });

  return { inserted, patched };
};

describe("provisionOrgWorkspace site domain", () => {
  test("a new project takes the org's subdomain as its domain", async () => {
    const { inserted } = await provisionAndCaptureProject({
      existingProject: undefined,
      subdomain: "acme",
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].domain).toBe("acme");
  });

  test("a new project from an older caller keeps the derived placeholder", async () => {
    const { inserted } = await provisionAndCaptureProject({
      existingProject: undefined,
    });
    expect(inserted[0].domain).toBe(deriveProjectDomain("org-1"));
  });

  test("re-provisioning moves an existing project onto the subdomain", async () => {
    const { patched } = await provisionAndCaptureProject({
      existingProject: {
        id: deriveProjectId("org-1"),
        domain: deriveProjectDomain("org-1"),
      },
      subdomain: "acme",
    });
    expect(patched).toEqual([{ domain: "acme" }]);
  });

  test("re-provisioning without a subdomain leaves the domain alone", async () => {
    const { patched } = await provisionAndCaptureProject({
      existingProject: { id: deriveProjectId("org-1"), domain: "acme" },
    });
    expect(patched).toEqual([]);
  });
});

describe("provisionOrgWorkspace lifecycle", () => {
  test("re-provisioning after an offboard restores the workspace and project", async () => {
    let workspaceUpsert: { body: unknown; prefer: string | null } | undefined;
    const projectPatches: Array<Record<string, unknown>> = [];
    server.use(
      db.post("User", () => empty({ status: 201 })),
      db.post("Workspace", async ({ request }) => {
        workspaceUpsert = {
          body: await request.json(),
          prefer: request.headers.get("Prefer"),
        };
        return empty({ status: 201 });
      }),
      db.post("Product", () => empty({ status: 201 })),
      db.post("TransactionLog", () => empty({ status: 201 })),
      db.delete("TransactionLog", () => empty({ status: 204 })),
      db.get("Project", () =>
        json({
          id: deriveProjectId("org-1"),
          domain: "acme",
          isDeleted: true,
        })
      ),
      db.patch("Project", async ({ request }) => {
        projectPatches.push((await request.json()) as Record<string, unknown>);
        return empty({ status: 204 });
      })
    );

    await provisionOrgWorkspace(testContext as unknown as AppContext, {
      organizationId: "org-1",
      orgName: "Org One (renamed)",
      adminEmails: [],
    });

    // The workspace row is merged, not ignored: the soft-delete is cleared and
    // the name follows the org.
    expect(workspaceUpsert?.body).toMatchObject({
      id: deriveWorkspaceId("org-1"),
      name: "Org One (renamed)",
      isDeleted: false,
    });
    expect(workspaceUpsert?.prefer ?? "").not.toMatch(/ignore-duplicates/);
    expect(projectPatches).toEqual([{ isDeleted: false }]);
  });

  test("a live project is not patched just to stay live", async () => {
    const projectPatches: Array<Record<string, unknown>> = [];
    server.use(
      db.post("User", () => empty({ status: 201 })),
      db.post("Workspace", () => empty({ status: 201 })),
      db.post("Product", () => empty({ status: 201 })),
      db.post("TransactionLog", () => empty({ status: 201 })),
      db.delete("TransactionLog", () => empty({ status: 204 })),
      db.get("Project", () =>
        json({ id: deriveProjectId("org-1"), domain: "acme", isDeleted: false })
      ),
      db.patch("Project", async ({ request }) => {
        projectPatches.push((await request.json()) as Record<string, unknown>);
        return empty({ status: 204 });
      })
    );

    await provisionOrgWorkspace(testContext as unknown as AppContext, {
      organizationId: "org-1",
      orgName: "Org One",
      adminEmails: [],
      subdomain: "acme",
    });

    expect(projectPatches).toEqual([]);
  });
});

/**
 * Provision "org-1" with `adminEmails`, where the workspace currently has
 * `activeMemberIds` as active members, and report the membership writes.
 * Every admin email resolves to the User id `u-<local part>`.
 */
const provisionAndCaptureMembers = async ({
  adminEmails,
  activeMemberIds,
}: {
  adminEmails: string[];
  activeMemberIds: string[];
}) => {
  const upserts: Array<Array<Record<string, unknown>>> = [];
  const retirements: Array<{ url: URL; body: Record<string, unknown> }> = [];
  server.use(
    db.post("User", () => empty({ status: 201 })),
    // resolveOrCreateUserByEmail: the admin already has an account.
    db.get("User", ({ request }) => {
      const email = new URL(request.url).searchParams.get("email") ?? "";
      const localPart = email.replace(/^eq\./, "").split("@")[0];
      return json({
        id: `u-${localPart}`,
        email,
        provider: "organizeos",
        projectsTags: [],
      });
    }),
    db.post("Workspace", () => empty({ status: 201 })),
    db.get("Workspace", () => json({ id: "ws-default" })),
    db.post("Product", () => empty({ status: 201 })),
    db.post("TransactionLog", () => empty({ status: 201 })),
    db.delete("TransactionLog", () => empty({ status: 204 })),
    db.get("Project", () =>
      json({ id: deriveProjectId("org-1"), domain: "acme", isDeleted: false })
    ),
    db.get("WorkspaceMember", () =>
      json(activeMemberIds.map((userId) => ({ userId })))
    ),
    db.post("WorkspaceMember", async ({ request }) => {
      upserts.push((await request.json()) as Array<Record<string, unknown>>);
      return empty({ status: 201 });
    }),
    db.patch("WorkspaceMember", async ({ request }) => {
      retirements.push({
        url: new URL(request.url),
        body: (await request.json()) as Record<string, unknown>,
      });
      return empty({ status: 204 });
    })
  );

  await provisionOrgWorkspace(testContext as unknown as AppContext, {
    organizationId: "org-1",
    orgName: "Org One",
    adminEmails,
  });

  return { upserts, retirements };
};

describe("provisionOrgWorkspace membership re-sync", () => {
  test("seats the current admins and retires everyone else", async () => {
    const { upserts, retirements } = await provisionAndCaptureMembers({
      adminEmails: ["keep@example.org", "new@example.org"],
      activeMemberIds: ["u-keep", "u-gone"],
    });

    expect(upserts).toEqual([
      [
        {
          workspaceId: deriveWorkspaceId("org-1"),
          userId: "u-keep",
          relation: "administrators",
          removedAt: null,
        },
        {
          workspaceId: deriveWorkspaceId("org-1"),
          userId: "u-new",
          relation: "administrators",
          removedAt: null,
        },
      ],
    ]);
    expect(retirements).toHaveLength(1);
    expect(retirements[0].url.searchParams.get("userId")).toBe("in.(u-gone)");
    expect(retirements[0].url.searchParams.get("removedAt")).toBe("is.null");
    expect(typeof retirements[0].body.removedAt).toBe("string");
  });

  test("retires nobody when the admin list already matches", async () => {
    const { retirements } = await provisionAndCaptureMembers({
      adminEmails: ["keep@example.org"],
      activeMemberIds: ["u-keep"],
    });
    expect(retirements).toEqual([]);
  });

  test("an empty admin list evicts nobody", async () => {
    const { upserts, retirements } = await provisionAndCaptureMembers({
      adminEmails: [],
      activeMemberIds: ["u-keep"],
    });
    expect(upserts).toEqual([]);
    expect(retirements).toEqual([]);
  });
});

describe("grantOrgWorkspaceMembership", () => {
  test("seats one admin in the org's workspace", async () => {
    let upsert: { body: unknown; prefer: string | null } | undefined;
    server.use(
      db.post("WorkspaceMember", async ({ request }) => {
        upsert = {
          body: await request.json(),
          prefer: request.headers.get("Prefer"),
        };
        return empty({ status: 201 });
      })
    );

    await grantOrgWorkspaceMembership(testContext as unknown as AppContext, {
      organizationId: "org-1",
      userId: "u-admin",
    });

    expect(upsert?.body).toEqual([
      {
        workspaceId: deriveWorkspaceId("org-1"),
        userId: "u-admin",
        relation: "administrators",
        removedAt: null,
      },
    ]);
    // An existing (possibly retired) row is merged back to active.
    expect(upsert?.prefer ?? "").toMatch(/merge-duplicates/);
  });

  test("throws on a store error", async () => {
    server.use(
      db.post("WorkspaceMember", () =>
        json({ message: "down" }, { status: 500 })
      )
    );
    await expect(
      grantOrgWorkspaceMembership(testContext as unknown as AppContext, {
        organizationId: "org-1",
        userId: "u-admin",
      })
    ).rejects.toBeTruthy();
  });
});
