import { describe, expect, test } from "vitest";
import { __testing__ } from "./selected-instance-effects";

const { parseComputedUnitValue } = __testing__;

/**
 * The no-Typed-OM path, which is what Firefox and Safari take. Before it
 * existed those browsers produced no property sizes at all, and the style
 * panel's keyword-to-unit conversion silently substituted 0 — picking "px" on
 * `width: auto` wrote `0px`.
 */
describe("parseComputedUnitValue", () => {
  test.each([
    ["1280px", { type: "unit", unit: "px", value: 1280 }],
    ["16.5px", { type: "unit", unit: "px", value: 16.5 }],
    ["50%", { type: "unit", unit: "%", value: 50 }],
    ["-4px", { type: "unit", unit: "px", value: -4 }],
    ["0.5s", { type: "unit", unit: "s", value: 0.5 }],
    ["45deg", { type: "unit", unit: "deg", value: 45 }],
  ])("reads %j off a resolved computed value", (input, expected) => {
    expect(parseComputedUnitValue(input)).toEqual(expected);
  });

  test("treats a bare number as unitless, the way CSSUnitValue does", () => {
    expect(parseComputedUnitValue("0")).toEqual({
      type: "unit",
      unit: "number",
      value: 0,
    });
    expect(parseComputedUnitValue("1.5")).toEqual({
      type: "unit",
      unit: "number",
      value: 1.5,
    });
  });

  test("tolerates the whitespace getComputedStyle can return", () => {
    expect(parseComputedUnitValue("  24px ")).toEqual({
      type: "unit",
      unit: "px",
      value: 24,
    });
  });

  test.each(["auto", "normal", "none", "rgb(0, 0, 0)", "1px solid red", ""])(
    "has no unit value for %j, so the caller keeps its own fallback",
    (input) => {
      expect(parseComputedUnitValue(input)).toBeUndefined();
    }
  );
});
