import { describe, expect, test, vi } from "vitest";
import {
  createTestServer,
  db,
  testContext,
  empty,
  json,
} from "@webstudio-is/postgrest/testing";
import type { AppContext } from "@webstudio-is/trpc-interface/index.server";
import {
  deriveProjectDomain,
  isOrgSubdomain,
  organizeosWebsiteAreaUrl,
  resolveOrganizeosDashboardExit,
  resolveOrgProjectDomain,
  resolveOrganizeosSite,
  syncOrgProjectDomain,
} from "./organizeos-site.server";

const ORG_ID = "f0e1d2c3-b4a5-4697-8877-665544332211";
const SERVICE_OWNER = {
  provider: "organizeos-service",
  email: `org+${ORG_ID}@svc.organizeos.internal`,
};

describe("subdomain shape", () => {
  test.each(["acme", "acme-local", "a1", "hq", "x".repeat(63)])(
    "accepts %j",
    (value) => {
      expect(isOrgSubdomain(value)).toBe(true);
    }
  );

  test.each([
    "",
    "-acme",
    "acme-",
    "Acme",
    "acme.local",
    "acme local",
    "x".repeat(64),
    42,
    undefined,
  ])("rejects %j", (value) => {
    expect(isOrgSubdomain(value)).toBe(false);
  });
});

describe("resolveOrgProjectDomain", () => {
  test("uses the subdomain when it is well-formed", () => {
    expect(resolveOrgProjectDomain("org-1", "acme")).toBe("acme");
  });

  test("falls back to the derived placeholder otherwise", () => {
    expect(resolveOrgProjectDomain("org-1", undefined)).toBe(
      deriveProjectDomain("org-1")
    );
    expect(resolveOrgProjectDomain("org-1", "Not Valid")).toBe(
      deriveProjectDomain("org-1")
    );
  });
});

describe("organizeosWebsiteAreaUrl", () => {
  test("points at the org's Website area on the app host", () => {
    expect(organizeosWebsiteAreaUrl("https://app.example.org/", "acme")).toBe(
      "https://app.example.org/acme/website"
    );
  });

  test("falls back to the dashboard when the subdomain is unknown", () => {
    expect(organizeosWebsiteAreaUrl("https://app.example.org", undefined)).toBe(
      "https://app.example.org/dashboard"
    );
  });
});

describe("resolveOrganizeosSite", () => {
  const base = {
    publisherHost: "example.org",
    platformUrl: "https://app.example.org",
  };

  test("describes an org project whose subdomain is known", () => {
    expect(
      resolveOrganizeosSite({
        ...base,
        owner: SERVICE_OWNER,
        projectDomain: "acme",
      })
    ).toEqual({
      organizationId: ORG_ID,
      subdomain: "acme",
      siteUrl: "https://acme.example.org",
      manageUrl: "https://app.example.org/acme/website",
      platformUrl: "https://app.example.org",
    });
  });

  test("an org project still on the placeholder has no site URL", () => {
    const site = resolveOrganizeosSite({
      ...base,
      owner: SERVICE_OWNER,
      projectDomain: deriveProjectDomain(ORG_ID),
    });
    expect(site?.organizationId).toBe(ORG_ID);
    expect(site?.subdomain).toBeUndefined();
    expect(site?.siteUrl).toBeUndefined();
    expect(site?.manageUrl).toBe("https://app.example.org/dashboard");
  });

  test("a human-owned project is not an OrganizeOS site", () => {
    expect(
      resolveOrganizeosSite({
        ...base,
        owner: { provider: "google", email: "me@example.org" },
        projectDomain: "my-site",
      })
    ).toBeUndefined();
  });

  test("a service account without a parseable org is not an OrganizeOS site", () => {
    expect(
      resolveOrganizeosSite({
        ...base,
        owner: { provider: "organizeos-service", email: null },
        projectDomain: "acme",
      })
    ).toBeUndefined();
  });
});

const server = createTestServer();
const context = testContext as unknown as AppContext;

describe("syncOrgProjectDomain", () => {
  test("moves the project onto a new subdomain", async () => {
    let patched: unknown;
    server.use(
      db.get("Project", () => json({ domain: "old-name" })),
      db.patch("Project", async ({ request }) => {
        patched = await request.json();
        return empty({ status: 204 });
      })
    );

    await expect(
      syncOrgProjectDomain(context, {
        projectId: "proj-1",
        organizationId: "org-1",
        subdomain: "new-name",
      })
    ).resolves.toEqual({ domain: "new-name", changed: true, conflict: false });
    expect(patched).toEqual({ domain: "new-name" });
  });

  test("is a no-op when the project already carries the subdomain", async () => {
    const patch = vi.fn(() => empty({ status: 204 }));
    server.use(
      db.get("Project", () => json({ domain: "acme" })),
      db.patch("Project", patch)
    );

    await expect(
      syncOrgProjectDomain(context, {
        projectId: "proj-1",
        organizationId: "org-1",
        subdomain: "acme",
      })
    ).resolves.toEqual({ domain: "acme", changed: false, conflict: false });
    expect(patch).not.toHaveBeenCalled();
  });

  test("never replaces a subdomain with the placeholder", async () => {
    const patch = vi.fn(() => empty({ status: 204 }));
    server.use(
      db.get("Project", () => json({ domain: "acme" })),
      db.patch("Project", patch)
    );

    await expect(
      syncOrgProjectDomain(context, {
        projectId: "proj-1",
        organizationId: "org-1",
        subdomain: undefined,
      })
    ).resolves.toEqual({ domain: "acme", changed: false, conflict: false });
    expect(patch).not.toHaveBeenCalled();
  });

  test("reports a domain another project already holds instead of throwing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    server.use(
      db.get("Project", () => json({ domain: "old-name" })),
      db.patch("Project", () =>
        json({ code: "23505", message: "duplicate key" }, { status: 409 })
      )
    );

    await expect(
      syncOrgProjectDomain(context, {
        projectId: "proj-1",
        organizationId: "org-1",
        subdomain: "taken",
      })
    ).resolves.toEqual({ domain: "old-name", changed: false, conflict: true });
  });

  test("throws when the project does not exist", async () => {
    server.use(db.get("Project", () => json([])));

    await expect(
      syncOrgProjectDomain(context, {
        projectId: "missing",
        organizationId: "org-1",
        subdomain: "acme",
      })
    ).rejects.toThrow(/not found/);
  });
});

describe("resolveOrganizeosDashboardExit", () => {
  const PLATFORM = "https://app.example.org";
  const exit = (
    workspaces: Array<{ id: string; userId: string; role: string }>
  ) =>
    resolveOrganizeosDashboardExit(context, {
      userId: "human-1",
      workspaces,
      publisherHost: "example.org",
      platformUrl: PLATFORM,
    });

  /** The org's service account owns "ws-org"; the user is a member, not owner. */
  const ORG_WORKSPACE = {
    id: "ws-org",
    userId: "svc-1",
    role: "administrators",
  };
  const OWN_WORKSPACE = { id: "ws-mine", userId: "human-1", role: "own" };
  const SERVICE_OWNER_ROW = {
    id: "svc-1",
    provider: "organizeos-service",
    email: `org+${ORG_ID}@svc.organizeos.internal`,
  };

  test("leaves a user who belongs to no shared workspace alone", async () => {
    // No queries at all: nothing is mocked, so an unhandled request would fail.
    await expect(exit([OWN_WORKSPACE])).resolves.toBeUndefined();
  });

  test("leaves a member of a human-owned workspace alone", async () => {
    server.use(db.get("User", () => json([])));

    await expect(
      exit([
        OWN_WORKSPACE,
        { id: "ws-friend", userId: "human-2", role: "viewers" },
      ])
    ).resolves.toBeUndefined();
  });

  test("leaves an org admin who also owns projects here alone", async () => {
    // The dashboard is the only way to reach their own projects.
    server.use(
      db.get("User", () => json([SERVICE_OWNER_ROW])),
      db.head("Project", () => empty({ headers: { "Content-Range": "*/2" } }))
    );

    await expect(exit([OWN_WORKSPACE, ORG_WORKSPACE])).resolves.toBeUndefined();
  });

  test("sends an org admin to their organization's Website area", async () => {
    server.use(
      db.get("User", () => json([SERVICE_OWNER_ROW])),
      db.head("Project", () => empty({ headers: { "Content-Range": "*/0" } })),
      db.get("Project", () => json({ domain: "acme" }))
    );

    await expect(exit([OWN_WORKSPACE, ORG_WORKSPACE])).resolves.toBe(
      `${PLATFORM}/acme/website`
    );
  });

  test("sends an admin of several orgs to the platform home", async () => {
    server.use(
      db.get("User", () =>
        json([SERVICE_OWNER_ROW, { ...SERVICE_OWNER_ROW, id: "svc-2" }])
      ),
      db.head("Project", () => empty({ headers: { "Content-Range": "*/0" } }))
    );

    await expect(
      exit([
        ORG_WORKSPACE,
        { id: "ws-org-2", userId: "svc-2", role: "administrators" },
      ])
    ).resolves.toBe(PLATFORM);
  });

  test("falls back to the platform home when the org has no readable project", async () => {
    server.use(
      db.get("User", () => json([SERVICE_OWNER_ROW])),
      db.head("Project", () => empty({ headers: { "Content-Range": "*/0" } })),
      db.get("Project", () => json([]))
    );

    await expect(exit([ORG_WORKSPACE])).resolves.toBe(PLATFORM);
  });

  test("throws rather than guessing when the owner lookup fails", async () => {
    // The caller fails open; it must be able to tell a failure from a decision.
    server.use(
      db.get("User", () => json({ message: "down" }, { status: 500 }))
    );

    await expect(exit([ORG_WORKSPACE])).rejects.toBeTruthy();
  });
});
