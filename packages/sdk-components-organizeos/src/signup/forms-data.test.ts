import { expect, test } from "vitest";
import forms from "../__fixtures__/forms.json";
import {
  orgDefaultFields,
  parseFormsData,
  resolveSignupForm,
} from "./forms-data";

const [newsletter, contactForm, membershipForm] = forms.data;

test("reads every form in the forms.json fixture", () => {
  expect(parseFormsData(forms)).toEqual(
    forms.data.map((form) => ({
      id: form.id,
      kind: form.kind,
      fields: form.fields,
    }))
  );
});

test("an empty record uses the org defaults", () => {
  expect(resolveSignupForm(undefined, forms)).toEqual({
    formId: undefined,
    fields: orgDefaultFields,
    unavailable: undefined,
  });
  expect(resolveSignupForm("  ", forms).formId).toBeUndefined();
  expect(
    orgDefaultFields
      .filter((field) => field.required)
      .map((field) => field.name)
  ).toEqual(["email"]);
});

test("a record resolves to its form's fields", () => {
  expect(resolveSignupForm(newsletter.id, forms)).toEqual({
    formId: newsletter.id,
    fields: newsletter.fields,
    unavailable: undefined,
  });
  expect(resolveSignupForm(contactForm.id, forms).fields).toEqual(
    contactForm.fields
  );
});

test("a record missing from data is unavailable", () => {
  expect(
    resolveSignupForm("00000000-0000-4000-8000-000000000000", forms)
  ).toEqual({
    formId: "00000000-0000-4000-8000-000000000000",
    fields: undefined,
    unavailable: "record",
  });
});

test("a membership form is unavailable to a Signup Form", () => {
  expect(resolveSignupForm(membershipForm.id, forms).unavailable).toBe("kind");
});

test("with no record, data is ignored: missing or malformed data still gives the org defaults", () => {
  for (const data of [undefined, null, "forms", [], {}, { data: {} }]) {
    for (const record of [undefined, ""]) {
      expect(resolveSignupForm(record, data)).toEqual({
        formId: undefined,
        fields: orgDefaultFields,
        unavailable: undefined,
      });
    }
  }
});

test("with a record, missing or malformed data is unavailable", () => {
  for (const data of [undefined, null, "forms", [], {}, { data: {} }]) {
    expect(resolveSignupForm(newsletter.id, data)).toEqual({
      formId: newsletter.id,
      fields: undefined,
      unavailable: "data",
    });
  }
});

test("reads leniently: unknown keys are ignored and unreadable entries skipped", () => {
  const data = {
    data: [
      "not a form",
      { id: 7, fields: [] },
      {
        id: "form-1",
        kind: "contact-signup",
        name: "Later DTO",
        added_later: true,
        fields: [
          { name: "email", type: "email", required: true, placeholder: "x" },
          { label: "No name" },
          { name: "topic", type: "select", options: ["A", 2, "B"] },
        ],
      },
    ],
  };
  expect(resolveSignupForm("form-1", data)).toEqual({
    formId: "form-1",
    fields: [
      {
        name: "email",
        label: "email",
        type: "email",
        required: true,
        options: null,
      },
      {
        name: "topic",
        label: "topic",
        type: "select",
        required: false,
        options: ["A", "B"],
      },
    ],
    unavailable: undefined,
  });
});
