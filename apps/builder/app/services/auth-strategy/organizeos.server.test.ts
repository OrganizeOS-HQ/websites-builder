import { beforeEach, describe, expect, test, vi } from "vitest";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { consumeSsoJti, organizeosSsoLogin } from "./organizeos.server";

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
