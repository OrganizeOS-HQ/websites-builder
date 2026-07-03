import { describe, expect, test } from "vitest";
import {
  parsePages,
  serializePages,
} from "@webstudio-is/project-build/index.server";
import {
  mergeSignupFormIntoBuild,
  type BuildContent,
} from "./signup-form-preset.server";

const args = {
  projectId: "project-1",
  apiBaseUrl: "https://app.example.org/api/public/v1",
  readToken: "osk_secrettoken",
};

const HOME_BODY = "home-body-id";

// A minimal but valid base build: a home page whose root is a body instance.
const makeBase = (): BuildContent => ({
  instances: [
    {
      id: HOME_BODY,
      type: "instance",
      component: "ws:element",
      tag: "body",
      children: [],
    },
  ],
  props: [],
  dataSources: [],
  resources: [],
  pages: {
    homePageId: "home",
    rootFolderId: "root",
    pages: new Map([
      [
        "home",
        {
          id: "home",
          name: "Home",
          path: "",
          title: `"Home"`,
          meta: {},
          rootInstanceId: HOME_BODY,
        },
      ],
    ]),
    folders: new Map([
      ["root", { id: "root", name: "Root", slug: "", children: ["home"] }],
    ]),
  },
});

describe("mergeSignupFormIntoBuild", () => {
  test("adds a Sign up page whose root resolves to a seeded body instance", () => {
    const merged = mergeSignupFormIntoBuild(makeBase(), args);

    const signupPage = [...merged.pages.pages.values()].find(
      (p) => p.path === "/signup"
    );
    expect(signupPage).toBeDefined();
    expect(signupPage?.name).toBe("Sign up");

    // The page root must point at an instance that actually exists in the merge.
    const rootId = signupPage!.rootInstanceId;
    const rootInstance = merged.instances.find((i) => i.id === rootId);
    expect(rootInstance).toBeDefined();
    expect(rootInstance?.component).toBe("ws:element");
  });

  test("keeps the existing home page and body intact", () => {
    const merged = mergeSignupFormIntoBuild(makeBase(), args);
    expect(merged.pages.pages.has("home")).toBe(true);
    expect(merged.instances.some((i) => i.id === HOME_BODY)).toBe(true);
    const rootFolder = merged.pages.folders.get("root");
    expect(rootFolder?.children).toContain("home");
    const signupPage = [...merged.pages.pages.values()].find(
      (p) => p.path === "/signup"
    );
    expect(rootFolder?.children).toContain(signupPage!.id);
  });

  test("carries the Form, its action resource, and the token variable into the build", () => {
    const merged = mergeSignupFormIntoBuild(makeBase(), args);
    expect(merged.instances.some((i) => i.component === "Form")).toBe(true);
    const action = merged.resources.find((r) => r.name === "action");
    expect(action?.url).toBe(`"https://app.example.org/api/public/v1/signups"`);
    expect(action?.headers.some((h) => h.name === "Authorization")).toBe(true);
    expect(
      merged.dataSources.some(
        (d) => d.type === "variable" && d.name === "Site read token"
      )
    ).toBe(true);
  });

  // The decisive headless check: the merged pages must survive the builder's
  // REAL load path (parsePages runs migratePages), which is exactly what the
  // builder does when opening the project. If this round-trips, the builder
  // will load the seeded page.
  test("the merged pages survive the builder's parse/serialize load path", () => {
    const merged = mergeSignupFormIntoBuild(makeBase(), args);
    const roundTripped = parsePages(serializePages(merged.pages));
    const signup = [...roundTripped.pages.values()].find(
      (p) => p.path === "/signup"
    );
    expect(signup).toBeDefined();
    expect(signup?.rootInstanceId).toBe(
      [...merged.pages.pages.values()].find((p) => p.path === "/signup")
        ?.rootInstanceId
    );
    // Root folder still references both pages after the round trip.
    const rootFolder = roundTripped.folders.get(roundTripped.rootFolderId);
    expect(rootFolder?.children).toContain("home");
    expect(rootFolder?.children).toContain(signup!.id);
  });

  test("is idempotent: re-seeding does not duplicate the page or instances", () => {
    const once = mergeSignupFormIntoBuild(makeBase(), args);
    const instanceCount = once.instances.length;
    const pageCount = once.pages.pages.size;

    const twice = mergeSignupFormIntoBuild(once, args);
    expect(twice.instances.length).toBe(instanceCount);
    expect(twice.pages.pages.size).toBe(pageCount);
    const signupPages = [...twice.pages.pages.values()].filter(
      (p) => p.path === "/signup"
    );
    expect(signupPages).toHaveLength(1);
    // The root folder lists the signup page exactly once.
    const rootFolder = twice.pages.folders.get("root");
    const signupId = signupPages[0].id;
    expect(rootFolder?.children.filter((c) => c === signupId)).toHaveLength(1);
  });
});
