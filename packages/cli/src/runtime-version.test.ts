import { expect, test } from "vitest";
import {
  PUBLISHED_RUNTIME_VERSION,
  VERSION_PLACEHOLDER,
  pinRuntimeDependencies,
} from "./runtime-version";

test("replaces the placeholder in every dependency map and nothing else", () => {
  const pinned = pinRuntimeDependencies({
    name: "site",
    dependencies: {
      "@webstudio-is/sdk": VERSION_PLACEHOLDER,
      react: "^19.0.0",
    },
    devDependencies: { "@webstudio-is/image": VERSION_PLACEHOLDER },
    scripts: { build: "react-router build" },
  });

  expect(pinned).toEqual({
    name: "site",
    dependencies: {
      "@webstudio-is/sdk": PUBLISHED_RUNTIME_VERSION,
      react: "^19.0.0",
    },
    devDependencies: { "@webstudio-is/image": PUBLISHED_RUNTIME_VERSION },
    scripts: { build: "react-router build" },
  });
});

test("does not mutate its input", () => {
  const input = { dependencies: { "@webstudio-is/sdk": VERSION_PLACEHOLDER } };
  pinRuntimeDependencies(input);
  expect(input.dependencies["@webstudio-is/sdk"]).toBe(VERSION_PLACEHOLDER);
});

test("fails the build if the placeholder survives outside a dependency map", () => {
  // A new upstream usage must fail here with a named cause, not on Vercel
  // after the site has been built and uploaded.
  expect(() =>
    pinRuntimeDependencies({ version: VERSION_PLACEHOLDER })
  ).toThrow(/survives in package.json/);
});

test("the pinned version is a real release, not the placeholder", () => {
  expect(PUBLISHED_RUNTIME_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  expect(PUBLISHED_RUNTIME_VERSION).not.toBe(VERSION_PLACEHOLDER);
});
