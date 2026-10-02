import {
  forwardRef,
  useContext,
  type ComponentProps,
  type ElementRef,
} from "react";
import { ReactSdkContext } from "@webstudio-is/react-sdk/runtime";
import { FormRootContext, useRegisterPart } from "../form/context";

/**
 * Submit Button: submits its root. Disabled, with `data-state="submitting"`,
 * while the root submits. On the canvas the submitting state only sets
 * `data-state`, for styling, so the button stays selectable.
 */
export const SubmitButton = forwardRef<
  ElementRef<"button">,
  ComponentProps<"button">
>(({ children, disabled, ...props }, ref) => {
  const { renderer } = useContext(ReactSdkContext);
  const root = useContext(FormRootContext);
  useRegisterPart({ kind: "submit" });
  const submitting = root?.state === "submitting";
  return (
    <button
      {...props}
      type="submit"
      disabled={(submitting && renderer !== "canvas") || disabled}
      data-state={submitting ? "submitting" : undefined}
      ref={ref}
    >
      {children}
    </button>
  );
});

SubmitButton.displayName = "SubmitButton";
