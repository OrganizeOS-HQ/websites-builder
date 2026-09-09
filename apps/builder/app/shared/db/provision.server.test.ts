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
