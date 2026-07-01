import { describe, expect, test } from "vitest";
import {
  createHmac,
  generateKeyPairSync,
  sign as cryptoSign,
} from "node:crypto";
import { verifyOrganizeosSsoToken } from "./organizeos-token.server";

const { publicKey, privateKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});
const publicKeyPem = publicKey.export({
  type: "spki",
  format: "pem",
}) as string;

// A second, unrelated keypair used to forge a "signed by the wrong key" token.
const other = generateKeyPairSync("ec", { namedCurve: "P-256" });

const NOW = 1_700_000_000_000; // fixed clock (ms)
const nowSeconds = Math.floor(NOW / 1000);

const b64url = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const validClaims = () => ({
  iss: "organizeos",
  aud: "webstudio-dashboard",
  sub: "user-1",
  email: "admin@example.org",
  organizationId: "org-1",
  iat: nowSeconds,
  exp: nowSeconds + 60,
  jti: "nonce-1",
});

const signES256 = (
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  key = privateKey
) => {
  const signingInput = `${b64url(header)}.${b64url(payload)}`;
  const signature = cryptoSign("sha256", Buffer.from(signingInput), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${signature.toString("base64url")}`;
};

const verify = (token: string) =>
  verifyOrganizeosSsoToken(token, publicKeyPem, { now: NOW });

describe("verifyOrganizeosSsoToken", () => {
  test("accepts a well-formed ES256 token and returns the claims", () => {
    const token = signES256({ alg: "ES256", typ: "JWT" }, validClaims());
    const claims = verify(token);
    expect(claims.email).toBe("admin@example.org");
    expect(claims.organizationId).toBe("org-1");
    expect(claims.jti).toBe("nonce-1");
  });

  // --- Algorithm-confusion defenses ---

  test("rejects alg:none (unsigned)", () => {
    const header = b64url({ alg: "none", typ: "JWT" });
    const payload = b64url(validClaims());
    const token = `${header}.${payload}.`;
    expect(() => verify(token)).toThrow(/algorithm/i);
  });

  test("rejects an HS256 token forged with the public key as the HMAC secret", () => {
    const header = b64url({ alg: "HS256", typ: "JWT" });
    const payload = b64url(validClaims());
    const signingInput = `${header}.${payload}`;
    // The classic attack: HMAC the signing input with the PUBLIC key as secret.
    const forged = createHmac("sha256", publicKeyPem)
      .update(signingInput)
      .digest("base64url");
    const token = `${signingInput}.${forged}`;
    expect(() => verify(token)).toThrow(/algorithm/i);
  });

  test("rejects a token signed by a different key", () => {
    const token = signES256(
      { alg: "ES256", typ: "JWT" },
      validClaims(),
      other.privateKey
    );
    expect(() => verify(token)).toThrow(/signature/i);
  });

  test("rejects a tampered payload (signature over the original)", () => {
    const header = b64url({ alg: "ES256", typ: "JWT" });
    const original = b64url(validClaims());
    const signingInput = `${header}.${original}`;
    const signature = cryptoSign("sha256", Buffer.from(signingInput), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url");
    const tampered = b64url({
      ...validClaims(),
      email: "attacker@evil.example",
    });
    const token = `${header}.${tampered}.${signature}`;
    expect(() => verify(token)).toThrow(/signature/i);
  });

  // --- Freshness / exp window ---

  test("rejects a missing exp", () => {
    const claims = validClaims();
    delete (claims as Partial<typeof claims>).exp;
    const token = signES256({ alg: "ES256", typ: "JWT" }, claims);
    expect(() => verify(token)).toThrow(/exp/i);
  });

  test("rejects an expired token", () => {
    const token = signES256(
      { alg: "ES256", typ: "JWT" },
      { ...validClaims(), exp: nowSeconds - 1 }
    );
    expect(() => verify(token)).toThrow(/expired/i);
  });

  test("rejects an exp too far in the future", () => {
    const token = signES256(
      { alg: "ES256", typ: "JWT" },
      { ...validClaims(), exp: nowSeconds + 3600 }
    );
    expect(() => verify(token)).toThrow(/future/i);
  });

  // --- Required claims ---

  test("rejects a wrong issuer", () => {
    const token = signES256(
      { alg: "ES256", typ: "JWT" },
      { ...validClaims(), iss: "someone-else" }
    );
    expect(() => verify(token)).toThrow(/issuer/i);
  });

  test("rejects a wrong audience", () => {
    const token = signES256(
      { alg: "ES256", typ: "JWT" },
      { ...validClaims(), aud: "some-other-app" }
    );
    expect(() => verify(token)).toThrow(/audience/i);
  });

  test.each(["email", "organizationId", "jti", "sub"] as const)(
    "rejects a missing %s claim",
    (field) => {
      const claims = validClaims();
      delete (claims as Record<string, unknown>)[field];
      const token = signES256({ alg: "ES256", typ: "JWT" }, claims);
      expect(() => verify(token)).toThrow(new RegExp(field, "i"));
    }
  );

  test("rejects a malformed token", () => {
    expect(() => verify("not-a-jwt")).toThrow(/malformed/i);
  });
});
