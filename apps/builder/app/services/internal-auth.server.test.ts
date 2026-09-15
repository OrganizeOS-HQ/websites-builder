import { describe, expect, test } from "vitest";
import {
  constantTimeEqual,
  isAuthorizedInternalCall,
} from "./internal-auth.server";

const request = (headers: Record<string, string>) =>
  new Request("https://builder.example.org/internal/x", {
    method: "POST",
    headers,
  });

describe("constantTimeEqual", () => {
  test("compares byte-for-byte", () => {
    expect(constantTimeEqual("secret", "secret")).toBe(true);
    expect(constantTimeEqual("secret", "secreT")).toBe(false);
    expect(constantTimeEqual("secret", "secret ")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });
});

describe("isAuthorizedInternalCall", () => {
  test("accepts the exact raw token with no cookie", () => {
    expect(
      isAuthorizedInternalCall(request({ Authorization: "tok" }), "tok")
    ).toBe(true);
  });

  test("an unset or empty secret disables the route instead of opening it", () => {
    expect(
      isAuthorizedInternalCall(request({ Authorization: "" }), undefined)
    ).toBe(false);
    expect(isAuthorizedInternalCall(request({ Authorization: "" }), "")).toBe(
      false
    );
  });

  test("rejects a wrong token, a Bearer-prefixed token, and a missing header", () => {
    expect(
      isAuthorizedInternalCall(request({ Authorization: "nope" }), "tok")
    ).toBe(false);
    expect(
      isAuthorizedInternalCall(request({ Authorization: "Bearer tok" }), "tok")
    ).toBe(false);
    expect(isAuthorizedInternalCall(request({}), "tok")).toBe(false);
  });

  test("rejects any request carrying a cookie, even with the right token", () => {
    expect(
      isAuthorizedInternalCall(
        request({ Authorization: "tok", Cookie: "_session=abc" }),
        "tok"
      )
    ).toBe(false);
  });
});
