import { describe, test, expect } from "vitest";
import {
  deriveSyntheticUserId,
  deriveWorkspaceId,
  deriveProjectId,
  deriveSyntheticEmail,
  deriveProjectDomain,
} from "./provision.server";

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
