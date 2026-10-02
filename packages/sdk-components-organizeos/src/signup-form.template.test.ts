import { expect, test } from "vitest";
import { encodeDataSourceVariable, type Instance } from "@webstudio-is/sdk";
import { showAttribute } from "@webstudio-is/react-sdk";
import { renderTemplate } from "@webstudio-is/template";
import * as metas from "./metas";
import { meta } from "./signup-form.template";

const namespace = "@organizeos/site-components";
const fragment = renderTemplate(meta.template);

const getInstance = (id: string) => {
  const instance = fragment.instances.find((item) => item.id === id);
  if (instance === undefined) {
    throw new Error(`no instance ${id}`);
  }
  return instance;
};

const childInstances = (instance: Instance) =>
  instance.children.flatMap((child) =>
    child.type === "id" ? [getInstance(child.value)] : []
  );

const propsOf = (instance: Instance) =>
  fragment.props.filter((prop) => prop.instanceId === instance.id);

const root = getInstance(fragment.children[0].value);
const [formState] = fragment.dataSources;
const formStateVariable = encodeDataSourceVariable(formState.id);

test("a hidden Signup Form template", () => {
  expect(meta.category).toBe("hidden");
  expect(meta.label).toBe("Signup Form");
  expect(root.component).toBe(`${namespace}:SignupForm`);
});

test("binds state and onStateChange to a formState variable like the Webhook Form, and leaves data unbound", () => {
  expect(fragment.dataSources).toEqual([
    {
      type: "variable",
      id: formState.id,
      scopeInstanceId: root.id,
      name: "formState",
      value: { type: "string", value: "initial" },
    },
  ]);
  const props = propsOf(root);
  expect(props.map((prop) => prop.name).sort()).toEqual([
    "onStateChange",
    "state",
  ]);
  expect(props.find((prop) => prop.name === "state")).toMatchObject({
    type: "expression",
    value: formStateVariable,
  });
  expect(props.find((prop) => prop.name === "onStateChange")).toMatchObject({
    type: "action",
    value: [
      {
        type: "execute",
        args: ["state"],
        code: `${formStateVariable} = state`,
      },
    ],
  });
});

test("state boxes show on formState", () => {
  const boxes = childInstances(root);
  const showOf = (instance: Instance) =>
    propsOf(instance).find((prop) => prop.name === showAttribute)?.value;
  const is = (state: string) => `${formStateVariable} === '${state}'`;
  expect(boxes.map((box) => [box.component, box.label, showOf(box)])).toEqual([
    [
      "ws:element",
      "Form Content",
      `${is("initial")} || ${is("submitting")} || ${is("error")}`,
    ],
    ["ws:element", "Success", is("success")],
    ["ws:element", "Check your email", is("confirm-email")],
    ["ws:element", "Error", is("error")],
    ["ws:element", "Unavailable", is("unavailable")],
  ]);
});

test("the form's content holds an Email and a First name Field, and a Submit Button", () => {
  const content = childInstances(childInstances(root)[0]);
  expect(content.map((instance) => instance.component)).toEqual([
    "ws:element",
    `${namespace}:Field`,
    `${namespace}:Field`,
    `${namespace}:SubmitButton`,
  ]);
  const fields = content.filter(
    (instance) => instance.component === `${namespace}:Field`
  );
  expect(
    fields.map(
      (field) => propsOf(field).find((prop) => prop.name === "field")?.value
    )
  ).toEqual(["email", "first_name"]);
  for (const field of fields) {
    expect(childInstances(field).map((part) => part.component)).toEqual([
      `${namespace}:FieldLabel`,
      `${namespace}:FieldInput`,
      `${namespace}:FieldMessage`,
    ]);
  }
});

test("parts are styled through the four shared OrganizeOS tokens", () => {
  const tokens = new Map(
    fragment.styleSources.flatMap((source) =>
      source.type === "token" ? [[source.id, source.name]] : []
    )
  );
  expect(Array.from(tokens.values()).sort()).toEqual([
    "OS Button",
    "OS Field",
    "OS Input",
    "OS Message",
  ]);
  const tokenOf = new Map<string, string>([
    [`${namespace}:Field`, "OS Field"],
    [`${namespace}:FieldInput`, "OS Input"],
    [`${namespace}:FieldMessage`, "OS Message"],
    [`${namespace}:SubmitButton`, "OS Button"],
  ]);
  for (const instance of fragment.instances) {
    const expected = tokenOf.get(instance.component);
    if (expected === undefined) {
      continue;
    }
    const selection = fragment.styleSourceSelections.find(
      (item) => item.instanceId === instance.id
    );
    expect(selection?.values.map((id) => tokens.get(id))).toEqual([expected]);
  }
});

test("every state a token styles is a state its component's meta lists", () => {
  const metasByComponent = new Map(
    Object.entries(metas).map(([name, meta]) => [`${namespace}:${name}`, meta])
  );
  let checked = 0;
  for (const selection of fragment.styleSourceSelections) {
    const instance = getInstance(selection.instanceId);
    const selectors = new Set(
      metasByComponent
        .get(instance.component)
        ?.states?.map((state) => state.selector)
    );
    for (const style of fragment.styles) {
      if (
        selection.values.includes(style.styleSourceId) &&
        style.state?.startsWith("[")
      ) {
        expect(selectors).toContain(style.state);
        checked += 1;
      }
    }
  }
  expect(checked).toBeGreaterThan(0);
});
