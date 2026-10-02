import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { ReactSdkContext } from "@webstudio-is/react-sdk/runtime";
import forms from "../__fixtures__/forms.json";
import { Field, FieldInput, FieldLabel, FieldMessage } from "./field";
import { SignupForm } from "./signup-form";
import { SubmitButton } from "./submit-button";

afterEach(() => {
  vi.restoreAllMocks();
});

// A published site renders on the server first (node: no window, no
// document), so a block must render there without touching the browser.
test("renders on the server as a published site does", () => {
  const consoleError = vi.spyOn(console, "error");
  const html = renderToString(
    <ReactSdkContext.Provider
      value={{
        assetBaseUrl: "/",
        imageLoader: ({ src }) => src,
        resources: {},
        breakpoints: [],
        onError: () => {},
      }}
    >
      <SignupForm data={forms} record={forms.data[0].id}>
        <Field field="email">
          <FieldLabel>Email</FieldLabel>
          <FieldInput />
          <FieldMessage />
        </Field>
        <Field field="favorite_color">
          <FieldLabel>Favorite color</FieldLabel>
          <FieldInput />
        </Field>
        <SubmitButton>Sign up</SubmitButton>
      </SignupForm>
    </ReactSdkContext.Provider>
  );
  expect(typeof window).toBe("undefined");
  expect(html).toMatch(/^<form method="post">/);
  expect(html).toContain('name="email"');
  expect(html).toContain('type="email"');
  expect(html).toContain('name="website"');
  // the canvas check never reaches a published page
  expect(html).not.toContain("data-organizeos-canvas-check");
  expect(consoleError).not.toHaveBeenCalled();
});
