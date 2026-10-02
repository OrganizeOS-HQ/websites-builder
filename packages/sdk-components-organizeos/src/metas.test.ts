import { expect, test } from "vitest";
import { wsComponentMeta } from "@webstudio-is/sdk";
import * as components from "./components";
import { hooks } from "./hooks";
import * as metas from "./metas";
import * as templates from "./templates";

const namespaced = (name: string) => `@organizeos/site-components:${name}`;

test("every component has a meta, and every meta a component", () => {
  expect(Object.keys(metas).sort()).toEqual(Object.keys(components).sort());
});

test("metas are valid, hidden from the Components panel, and labelled", () => {
  for (const [name, meta] of Object.entries(metas)) {
    expect(() => wsComponentMeta.parse(meta), name).not.toThrow();
    expect(meta.category, name).toBe("hidden");
    expect(meta.label, name).toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)*$/);
  }
  expect(metas.SignupForm.label).toBe("Signup Form");
  expect(metas.SubmitButton.label).toBe("Submit Button");
});

test("content models keep each part inside its own root", () => {
  expect(metas.SignupForm.contentModel).toEqual({
    category: "instance",
    children: ["instance"],
    descendants: [namespaced("Field"), namespaced("SubmitButton")],
  });
  expect(metas.Field.contentModel).toEqual({
    category: "none",
    children: ["instance"],
    descendants: [
      namespaced("FieldLabel"),
      namespaced("FieldInput"),
      namespaced("FieldMessage"),
    ],
  });
  for (const part of [
    metas.Field,
    metas.FieldLabel,
    metas.FieldInput,
    metas.FieldMessage,
    metas.SubmitButton,
  ]) {
    expect(part.contentModel?.category).toBe("none");
  }
});

test("states and prop controls", () => {
  expect(metas.FieldInput.states).toContainEqual({
    label: "Invalid",
    selector: "[data-invalid]",
  });
  expect(metas.SubmitButton.states).toContainEqual({
    label: "Submitting",
    selector: '[data-state="submitting"]',
  });
  const controls = (meta: (typeof metas)[keyof typeof metas]) =>
    Object.fromEntries(
      Object.entries(meta.props ?? {}).map(([name, prop]) => [
        name,
        prop.control,
      ])
    );
  expect(controls(metas.SignupForm)).toEqual({
    record: "text",
    data: "json",
    state: "select",
    action: "radio",
    actionPage: "url",
  });
  expect(controls(metas.Field)).toEqual({ field: "text" });
  expect(metas.SignupForm.props?.state).toMatchObject({
    defaultValue: "initial",
    options: [
      "initial",
      "submitting",
      "success",
      "confirm-email",
      "error",
      "unavailable",
    ],
  });
  expect(metas.SignupForm.props?.action).toMatchObject({
    defaultValue: "state",
    options: ["state", "page"],
  });
});

test("templates and hooks", () => {
  expect(Object.keys(templates)).toEqual(["SignupForm"]);
  expect(templates.SignupForm.category).toBe("hidden");
  expect(hooks).toEqual([]);
});
