import { describe, expect, test } from "vitest";
import {
  buildSignupFormData,
  SIGNUP_FORM_FIELD_NAMES,
} from "./signup-form-preset.server";

const args = {
  projectId: "project-1",
  apiBaseUrl: "https://app.example.org/api/public/v1",
  readToken: "osk_secrettoken",
};

const build = () => buildSignupFormData(args);

describe("buildSignupFormData", () => {
  test("renders a Form instance wrapped in a body", async () => {
    const { data, bodyId } = await build();
    const instances = [...data.instances.values()];
    expect(instances.some((i) => i.component === "Form")).toBe(true);
    const body = data.instances.get(bodyId);
    expect(body?.component).toBe("ws:element");
    expect(body?.tag).toBe("body");
  });

  test("turns the form action into a server-side action resource pointed at /v1/signups", async () => {
    const { data } = await build();
    const action = [...data.resources.values()].find(
      (r) => r.name === "action"
    );
    expect(action).toBeDefined();
    expect(action?.method).toBe("post");
    expect(action?.url).toBe(`"https://app.example.org/api/public/v1/signups"`);
    // A prop of type 'resource' is what makes it an ACTION (not a loader) resource.
    const actionProp = [...data.props.values()].find(
      (p) => p.name === "action" && p.type === "resource"
    );
    expect(actionProp?.value).toBe(action?.id);
  });

  test("inlines the org token into the action Authorization header as a literal", async () => {
    const { data } = await build();

    // No token variable: variables are instance-scoped and page codegen drops
    // out-of-scope ones (publish spike produced "Bearer " + undefined).
    expect(
      [...data.dataSources.values()].some(
        (d) => d.type === "variable" && d.name === "Site read token"
      )
    ).toBe(false);

    const action = [...data.resources.values()].find(
      (r) => r.name === "action"
    );
    const auth = action?.headers.find((h) => h.name === "Authorization");
    expect(auth?.value).toBe(`"Bearer osk_secrettoken"`);
    // Content-Type is preserved so the endpoint receives JSON.
    expect(action?.headers.some((h) => h.name === "Content-Type")).toBe(true);
  });

  test("uses input names that match the /v1/signups schema keys", async () => {
    const { data } = await build();
    const inputNames = [...data.props.values()]
      .filter((p) => p.name === "name" && p.type === "string")
      .map((p) => (p.type === "string" ? p.value : ""));
    for (const field of SIGNUP_FORM_FIELD_NAMES) {
      expect(inputNames).toContain(field);
    }
  });

  test("wires a formState variable for success/error visibility", async () => {
    const { data } = await build();
    const formState = [...data.dataSources.values()].find(
      (d) => d.type === "variable" && d.name === "formState"
    );
    expect(formState).toBeDefined();
  });

  test("is deterministic per project and differs across projects", async () => {
    const a1 = await build();
    const a2 = await build();
    expect([...a1.data.instances.keys()].sort()).toEqual(
      [...a2.data.instances.keys()].sort()
    );
    expect(a1.bodyId).toBe(a2.bodyId);

    const b = await buildSignupFormData({ ...args, projectId: "project-2" });
    expect(b.bodyId).not.toBe(a1.bodyId);
    expect(b.pageId).not.toBe(a1.pageId);
  });

  test("trims a trailing slash on the API base URL", async () => {
    const { data } = await buildSignupFormData({
      ...args,
      apiBaseUrl: "https://app.example.org/api/public/v1/",
    });
    const action = [...data.resources.values()].find(
      (r) => r.name === "action"
    );
    expect(action?.url).toBe(`"https://app.example.org/api/public/v1/signups"`);
  });
});
