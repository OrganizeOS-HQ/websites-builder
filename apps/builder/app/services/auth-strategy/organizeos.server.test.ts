import { beforeEach, describe, expect, test, vi } from "vitest";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { deriveProjectId } from "~/shared/db/provision.server";
import {
  consumeSsoJti,
  organizeosSsoLogin,
  resolveSsoLandingUrl,
} from "./organizeos.server";

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock("~/shared/db/user.server", () => ({
  resolveOrCreateUserByEmail: vi.fn(async () => ({ id: "resolved-user-id" })),
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

const makeToken = (jti = "nonce-1") => {
  const header = b64url({ alg: "ES256", typ: "JWT" });
  const payload = b64url({
    iss: "organizeos",
    aud: "webstudio-dashboard",
    sub: "user-1",
    email: "admin@example.org",
    organizationId: "org-1",
    exp: Math.floor(Date.now() / 1000) + 60,
    jti,
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
