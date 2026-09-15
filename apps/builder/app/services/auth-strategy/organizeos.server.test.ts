import { beforeEach, describe, expect, test, vi } from "vitest";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import {
  deriveProjectId,
  deriveSyntheticUserId,
} from "~/shared/db/provision.server";
import {
  consumeSsoJti,
  organizeosSsoLogin,
  resolveSsoLandingUrl,
  resolveSsoReturnTo,
} from "./organizeos.server";

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock("~/shared/db/user.server", () => ({
  resolveOrCreateUserByEmail: vi.fn(async () => ({ id: "resolved-user-id" })),
}));

vi.mock("~/shared/db/organizeos-plan.server", () => ({
  syncOrgOwnerPlan: vi.fn(async () => undefined),
}));

vi.mock("~/shared/db/provision.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/shared/db/provision.server")>()),
  grantOrgWorkspaceMembership: vi.fn(async () => undefined),
}));

vi.mock("~/shared/db/organizeos-site.server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/shared/db/organizeos-site.server")
  >()),
  syncOrgProjectDomain: vi.fn(async () => ({
    domain: "acme",
    changed: true,
    conflict: false,
  })),
}));

const { publicKey, privateKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});
const publicKeyPem = publicKey.export({
  type: "spki",
  format: "pem",
}) as string;

const b64url = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const makeToken = (jti = "nonce-1", extraClaims: object = {}) => {
  const header = b64url({ alg: "ES256", typ: "JWT" });
  const payload = b64url({
    iss: "organizeos",
    aud: "webstudio-dashboard",
    sub: "user-1",
    email: "admin@example.org",
    organizationId: "org-1",
    exp: Math.floor(Date.now() / 1000) + 60,
    jti,
    ...extraClaims,
  });
  const signature = cryptoSign("sha256", Buffer.from(`${header}.${payload}`), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${header}.${payload}.${signature}`;
};

describe("consumeSsoJti", () => {
  test("resolves when the insert succeeds (first use)", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const context = { postgrest: { client: { from: () => ({ insert }) } } };
    await expect(
      consumeSsoJti(context as never, "nonce-1")
    ).resolves.toBeUndefined();
    expect(insert).toHaveBeenCalledWith({ jti: "nonce-1" });
  });

  test("throws on a unique-violation (replay)", async () => {
    const context = {
      postgrest: {
        client: {
          from: () => ({ insert: async () => ({ error: { code: "23505" } }) }),
        },
      },
    };
    await expect(consumeSsoJti(context as never, "nonce-1")).rejects.toThrow();
  });

  test("fails closed on any other store error", async () => {
    const context = {
      postgrest: {
        client: {
          from: () => ({
            insert: async () => ({ error: { code: "08006", message: "down" } }),
          }),
        },
      },
    };
    await expect(consumeSsoJti(context as never, "nonce-1")).rejects.toThrow();
  });
});

describe("organizeosSsoLogin", () => {
  test("verifies, consumes the jti, and resolves the user", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const context = { postgrest: { client: { from: () => ({ insert }) } } };

    const result = await organizeosSsoLogin(
      context as never,
      makeToken(),
      publicKeyPem
    );
    expect(result.userId).toBe("resolved-user-id");
    expect(insert).toHaveBeenCalledWith({ jti: "nonce-1" });
  });

  test("rejects an invalid token BEFORE any store access", async () => {
    const from = vi.fn(() => {
      throw new Error("store must not be touched");
    });
    const context = { postgrest: { client: { from } } };
    await expect(
      organizeosSsoLogin(context as never, "not-a-jwt", publicKeyPem)
    ).rejects.toThrow(/malformed/i);
    expect(from).not.toHaveBeenCalled();
  });

  test("does not resolve a user when the jti was already used (replay)", async () => {
    const { resolveOrCreateUserByEmail } = await import(
      "~/shared/db/user.server"
    );
    const context = {
      postgrest: {
        client: {
          from: () => ({ insert: async () => ({ error: { code: "23505" } }) }),
        },
      },
    };
    await expect(
      organizeosSsoLogin(context as never, makeToken("replayed"), publicKeyPem)
    ).rejects.toThrow();
    expect(resolveOrCreateUserByEmail).not.toHaveBeenCalled();
  });

  test("refreshes the org's plan from the signed entitlements", async () => {
    const { syncOrgOwnerPlan } = await import(
      "~/shared/db/organizeos-plan.server"
    );
    const context = {
      postgrest: {
        client: { from: () => ({ insert: async () => ({ error: null }) }) },
      },
    };

    await organizeosSsoLogin(
      context as never,
      makeToken("nonce-ent", { entitlements: { collections: true } }),
      publicKeyPem
    );

    // Applied to the org's workspace owner, not the admin signing in.
    expect(syncOrgOwnerPlan).toHaveBeenCalledWith(context, {
      serviceUserId: deriveSyntheticUserId("org-1"),
      entitlements: { collections: true },
    });
  });

  test("leaves the provisioned plan alone when the token carries no entitlements", async () => {
    const { syncOrgOwnerPlan } = await import(
      "~/shared/db/organizeos-plan.server"
    );
    const context = {
      postgrest: {
        client: { from: () => ({ insert: async () => ({ error: null }) }) },
      },
    };

    await organizeosSsoLogin(
      context as never,
      makeToken("nonce-none"),
      publicKeyPem
    );

    expect(syncOrgOwnerPlan).not.toHaveBeenCalled();
  });

  test("still logs the admin in when the entitlement refresh fails", async () => {
    const { syncOrgOwnerPlan } = await import(
      "~/shared/db/organizeos-plan.server"
    );
    vi.mocked(syncOrgOwnerPlan).mockRejectedValueOnce(
      new Error("postgrest down")
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const context = {
      postgrest: {
        client: { from: () => ({ insert: async () => ({ error: null }) }) },
      },
    };

    const result = await organizeosSsoLogin(
      context as never,
      makeToken("nonce-fail", { entitlements: { collections: true } }),
      publicKeyPem
    );

    expect(result.userId).toBe("resolved-user-id");
  });
});

describe("organizeosSsoLogin workspace seat", () => {
  const context = {
    postgrest: {
      client: { from: () => ({ insert: async () => ({ error: null }) }) },
    },
  };

  test("seats the verified admin in the org's workspace", async () => {
    const { grantOrgWorkspaceMembership } = await import(
      "~/shared/db/provision.server"
    );

    await organizeosSsoLogin(
      context as never,
      makeToken("nonce-seat"),
      publicKeyPem
    );

    expect(grantOrgWorkspaceMembership).toHaveBeenCalledWith(context, {
      organizationId: "org-1",
      userId: "resolved-user-id",
    });
  });

  test("still logs the admin in when the seat cannot be written", async () => {
    const { grantOrgWorkspaceMembership } = await import(
      "~/shared/db/provision.server"
    );
    vi.mocked(grantOrgWorkspaceMembership).mockRejectedValueOnce(
      new Error("postgrest down")
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await organizeosSsoLogin(
      context as never,
      makeToken("nonce-seat-fail"),
      publicKeyPem
    );

    expect(result.userId).toBe("resolved-user-id");
  });

  test("never seats anyone for a token that fails verification", async () => {
    const { grantOrgWorkspaceMembership } = await import(
      "~/shared/db/provision.server"
    );
    await expect(
      organizeosSsoLogin(context as never, "not-a-jwt", publicKeyPem)
    ).rejects.toThrow();
    expect(grantOrgWorkspaceMembership).not.toHaveBeenCalled();
  });
});

describe("organizeosSsoLogin site refresh", () => {
  const context = {
    postgrest: {
      client: { from: () => ({ insert: async () => ({ error: null }) }) },
    },
  };

  test("mirrors the signed subdomain into the org project's domain", async () => {
    const { syncOrgProjectDomain } = await import(
      "~/shared/db/organizeos-site.server"
    );

    await organizeosSsoLogin(
      context as never,
      makeToken("nonce-sub", { subdomain: "acme" }),
      publicKeyPem
    );

    expect(syncOrgProjectDomain).toHaveBeenCalledWith(context, {
      projectId: deriveProjectId("org-1"),
      organizationId: "org-1",
      subdomain: "acme",
    });
  });

  test("leaves the domain alone when the token carries no subdomain", async () => {
    const { syncOrgProjectDomain } = await import(
      "~/shared/db/organizeos-site.server"
    );

    await organizeosSsoLogin(
      context as never,
      makeToken("nonce-nosub"),
      publicKeyPem
    );

    expect(syncOrgProjectDomain).not.toHaveBeenCalled();
  });

  test("still logs the admin in when the domain sync fails", async () => {
    const { syncOrgProjectDomain } = await import(
      "~/shared/db/organizeos-site.server"
    );
    vi.mocked(syncOrgProjectDomain).mockRejectedValueOnce(
      new Error("postgrest down")
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await organizeosSsoLogin(
      context as never,
      makeToken("nonce-subfail", { subdomain: "acme" }),
      publicKeyPem
    );

    expect(result.userId).toBe("resolved-user-id");
  });
});

describe("resolveSsoLandingUrl", () => {
  const ORIGIN = "https://builder.example.com";

  test("deep-links into the org's derived project builder", () => {
    const url = resolveSsoLandingUrl(makeToken(), ORIGIN);
    const expectedProjectId = deriveProjectId("org-1");
    expect(url).not.toBeNull();
    // Builder lives on the p-<projectId> subdomain of the auth origin.
    expect(new URL(url!).host).toBe(
      `p-${expectedProjectId}.builder.example.com`
    );
  });

  test("is deterministic for the same org across tokens", () => {
    expect(resolveSsoLandingUrl(makeToken("jti-a"), ORIGIN)).toBe(
      resolveSsoLandingUrl(makeToken("jti-b"), ORIGIN)
    );
  });

  test.each(["not-a-jwt", "a.b", "", "a.!!!notbase64.c"])(
    "returns null (dashboard fallback) for unparsable input %j",
    (input) => {
      expect(resolveSsoLandingUrl(input, ORIGIN)).toBeNull();
    }
  );

  test("returns null when the payload has no organizationId", () => {
    const header = b64url({ alg: "ES256", typ: "JWT" });
    const payload = b64url({ email: "admin@example.org" });
    expect(resolveSsoLandingUrl(`${header}.${payload}.sig`, ORIGIN)).toBeNull();
  });
});

describe("resolveSsoReturnTo", () => {
  const DEEP_LINK = "https://p-abc.builder.example.com/";
  const DASHBOARD = "/dashboard";
  const resolve = (
    storedReturnTo: string | null,
    deepLink: string | null = DEEP_LINK
  ) =>
    resolveSsoReturnTo({ storedReturnTo, deepLink, dashboardPath: DASHBOARD });

  test("lands on the org's project when nothing was stored", () => {
    expect(resolve(null)).toBe(DEEP_LINK);
  });

  test("honours a stored returnTo that goes somewhere else", () => {
    // Mid-flow re-authentication is the case the cookie exists for.
    expect(resolve("https://p-abc.builder.example.com/?pageId=home")).toBe(
      "https://p-abc.builder.example.com/?pageId=home"
    );
  });

  test.each([DASHBOARD, "/dashboard/search", "/dashboard?workspaceId=ws-1"])(
    "ignores a stored returnTo pointing at the fork dashboard (%j)",
    (stored) => {
      // Any earlier visit to /login sets this cookie; it used to outrank the
      // deep link and drop the admin on a dashboard OrganizeOS does not use.
      expect(resolve(stored)).toBe(DEEP_LINK);
    }
  );

  test("falls back to the dashboard only when there is no deep link", () => {
    expect(resolve(null, null)).toBe(DASHBOARD);
    expect(resolve(DASHBOARD, null)).toBe(DASHBOARD);
  });
});
