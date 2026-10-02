import {
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ElementRef,
  type FormEvent,
} from "react";
import { ReactSdkContext } from "@webstudio-is/react-sdk/runtime";
import { CanvasCheck } from "../form/canvas-check";
import {
  FormRootContext,
  usePartRegistry,
  type FormFieldConfig,
  type FormPart,
  type FormRoot,
} from "../form/context";
import { useMergedRef } from "../form/merge-ref";
import { navigateTo } from "../form/navigate";
import {
  isBuilderRender,
  postToPlatform,
  stateForAnswer,
  type AnswerStates,
} from "../form/submit";
import { resolveSignupForm, type SignupFormResolution } from "./forms-data";
import { signupsPath, type SignupFormState } from "./states";

/**
 * The text `onStateChange` passes with each state, for a text element the
 * designer binds. Generic on purpose: the platform's own words never reach
 * the visitor.
 */
const stateMessages: Record<SignupFormState, string> = {
  initial: "",
  submitting: "",
  success: "Thank you.",
  "confirm-email": "Check your email to confirm.",
  error: "Something went wrong. Please try again.",
  unavailable: "This form is not available right now.",
};

const invalidFieldMessage = "Please check the form and try again.";

/** The Field Message text for a field the platform refused. */
const fieldErrorMessage = (field: FormFieldConfig | undefined) => {
  if (field?.type === "email") {
    return "Enter a valid email address.";
  }
  if (field?.type === "phone" || field?.type === "tel") {
    return "Enter a valid phone number.";
  }
  return "Please check this field.";
};

const answerStates: AnswerStates<SignupFormState> = {
  outcomes: {
    subscribed: "success",
    received: "success",
    confirm_email: "confirm-email",
  },
  success: "success",
  error: "error",
};

/** The states in which the template shows the form's content, and its parts. */
const formContentStates: ReadonlySet<string> = new Set([
  "initial",
  "submitting",
  "error",
]);

const honeypotStyle: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  margin: "-1px",
  padding: 0,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/** The `POST /api/public/site/v1/signups` body. */
const buildSignupBody = ({
  formId,
  fields,
  parts,
  pagePath,
  honeypot,
}: {
  formId: string | undefined;
  fields: readonly FormFieldConfig[];
  parts: readonly FormPart[];
  pagePath: string;
  honeypot: string;
}) => {
  const values = new Map<string, string>();
  for (const part of parts) {
    if (
      part.kind !== "input" ||
      part.name === undefined ||
      part.read === undefined
    ) {
      continue;
    }
    // two inputs for one field: keep the one the visitor filled in
    if (values.get(part.name)) {
      continue;
    }
    values.set(part.name, part.read());
  }
  // only the form's own fields, in the form's order
  const entries: Array<[string, string]> = [];
  for (const field of fields) {
    const value = values.get(field.name);
    if (value !== undefined) {
      entries.push([field.name, value]);
    }
  }
  return {
    ...(formId === undefined ? {} : { form_id: formId }),
    fields: Object.fromEntries(entries),
    page_path: pagePath,
    website: honeypot,
  };
};

/** What the canvas check reports for a Signup Form. */
const getProblems = ({
  resolution,
  parts,
  nesting,
  state,
}: {
  resolution: SignupFormResolution;
  parts: readonly FormPart[];
  nesting: undefined | "root" | "form";
  state: string;
}) => {
  const problems: string[] = [];
  if (nesting === "root") {
    problems.push(
      "It sits inside another OrganizeOS form. Forms cannot nest: move it out."
    );
  }
  if (nesting === "form") {
    problems.push("It sits inside a Form. Forms cannot nest: move it out.");
  }
  if (resolution.unavailable === "data") {
    problems.push(
      "Its Forms data is missing or did not load, so its form cannot be found and the live site shows the Unavailable state."
    );
  }
  if (resolution.unavailable === "record") {
    problems.push(
      "Its form is not available: unpublished, deleted, or not offered to websites. Pick another form, or none for the org defaults."
    );
  }
  if (resolution.unavailable === "kind") {
    problems.push(
      "Its form is a membership form, which a Signup Form cannot submit. Pick a newsletter or contact form."
    );
  }
  const { fields } = resolution;
  // The template hides the form's content in the other states, which
  // unmounts its parts: a check then would report parts that are only hidden.
  if (fields === undefined || formContentStates.has(state) === false) {
    return problems;
  }
  const fieldNames = new Set<string>();
  let hasSubmit = false;
  for (const part of parts) {
    if (part.kind === "field" && part.name !== undefined) {
      fieldNames.add(part.name);
    }
    if (part.kind === "submit") {
      hasSubmit = true;
    }
  }
  const missing = fields.filter(
    (field) => field.required && fieldNames.has(field.name) === false
  );
  if (missing.some((field) => field.name === "email")) {
    problems.push("Add a Field for email: the form requires it.");
  }
  if (hasSubmit === false) {
    problems.push("Add a Submit Button.");
  }
  for (const field of missing) {
    if (field.name !== "email") {
      problems.push(
        `Add a Field for "${field.label}" (${field.name}): the form requires it.`
      );
    }
  }
  const known = new Set(fields.map((field) => field.name));
  for (const name of fieldNames) {
    if (name === "") {
      problems.push("A Field has no form field. Set one in its settings.");
    } else if (known.has(name) === false) {
      problems.push(
        `A Field is set to "${name}", which its form does not have.`
      );
    }
  }
  return problems;
};

type SignupFormProps = Omit<ComponentProps<"form">, "action" | "onSubmit"> & {
  /** The form's id, from the Forms data. Empty for the org defaults. */
  record?: string;
  /** The `GET /v1/forms` body, `{ data: Form[] }`: the project's Forms preset. */
  data?: unknown;
  /** Reveals a state on the canvas; bound to the template's `formState` variable. */
  state?: SignupFormState;
  /** Called with each new state and a generic message for it. */
  onStateChange?: (state: SignupFormState, message: string) => void;
  /** After a successful signup: show the Success state, or go to `actionPage`. */
  action?: "state" | "page";
  actionPage?: string;
};

/**
 * Signup Form: the root of the signup block. Renders the `<form>`, finds its
 * form in `data` by `record` (or uses the org defaults), and on a published
 * site posts what its parts collect to the platform's signups endpoint on the
 * page's own origin. On the canvas it checks its parts and draws a warning on
 * itself; the canvas and the preview never post.
 */
export const SignupForm = forwardRef<ElementRef<"form">, SignupFormProps>(
  (
    {
      record,
      data,
      state = "initial",
      onStateChange,
      action = "state",
      actionPage,
      children,
      ...props
    },
    forwardedRef
  ) => {
    const { renderer } = useContext(ReactSdkContext);
    const parentRoot = useContext(FormRootContext);
    const resolution = useMemo(
      () => resolveSignupForm(record, data),
      [record, data]
    );
    const { parts, register } = usePartRegistry();
    const formRef = useRef<HTMLFormElement | null>(null);
    const ref = useMergedRef(forwardedRef, formRef);
    const honeypotRef = useRef<HTMLInputElement>(null);

    // The current state follows the state prop (the bound variable, or the
    // design-time selector on the canvas) and moves on with a submission, so
    // the parts are right even when no variable is bound.
    const [current, setCurrent] = useState<string>(state);
    const [stateProp, setStateProp] = useState(state);
    if (state !== stateProp) {
      setStateProp(state);
      setCurrent(state);
    }
    const [fieldErrors, setFieldErrors] = useState<ReadonlyMap<string, string>>(
      () => new Map()
    );

    const onStateChangeRef = useRef(onStateChange);
    useLayoutEffect(() => {
      onStateChangeRef.current = onStateChange;
    });
    const report = useCallback((next: SignupFormState, message: string) => {
      setCurrent(next);
      onStateChangeRef.current?.(next, message);
    }, []);

    // A published site shows its Unavailable state; the canvas warns instead.
    const unavailable = resolution.unavailable !== undefined;
    useEffect(() => {
      if (renderer === undefined && unavailable) {
        report("unavailable", stateMessages.unavailable);
      }
    }, [renderer, unavailable, report]);

    const submitting = useRef(false);
    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      // the builder's canvas and preview never post
      if (isBuilderRender(renderer) || submitting.current) {
        return;
      }
      const { formId, fields } = resolution;
      if (resolution.unavailable !== undefined || fields === undefined) {
        report("unavailable", stateMessages.unavailable);
        return;
      }
      const body = buildSignupBody({
        formId,
        fields,
        parts,
        pagePath: window.location.pathname,
        honeypot: honeypotRef.current?.value ?? "",
      });
      submitting.current = true;
      setFieldErrors(new Map());
      report("submitting", stateMessages.submitting);
      void postToPlatform({ renderer, path: signupsPath, body }).then(
        (answer) => {
          submitting.current = false;
          if (answer === undefined) {
            return;
          }
          const { state: next, field } = stateForAnswer(answer, answerStates);
          if (field !== undefined) {
            const config = fields.find((item) => item.name === field);
            setFieldErrors(new Map([[field, fieldErrorMessage(config)]]));
          }
          report(
            next,
            field === undefined ? stateMessages[next] : invalidFieldMessage
          );
          if (
            next === "success" &&
            action === "page" &&
            typeof actionPage === "string" &&
            actionPage !== ""
          ) {
            navigateTo(actionPage);
          }
        }
      );
    };

    // Canvas check: a form inside another form is invalid HTML and cannot
    // submit, and the upstream Form's content model is not ours to change.
    // Moving an instance on the canvas remounts it, so checking on mount is
    // enough.
    const [insideForm, setInsideForm] = useState(false);
    useLayoutEffect(() => {
      if (renderer === "canvas") {
        setInsideForm(Boolean(formRef.current?.parentElement?.closest("form")));
      }
    }, [renderer]);
    let nesting: undefined | "root" | "form";
    if (parentRoot !== undefined) {
      nesting = "root";
    } else if (insideForm) {
      nesting = "form";
    }
    const problems =
      renderer === "canvas"
        ? getProblems({ resolution, parts, nesting, state: current })
        : [];

    const root = useMemo<FormRoot>(
      () => ({
        register,
        fields: resolution.fields,
        fieldErrors,
        state: current,
      }),
      [register, resolution.fields, fieldErrors, current]
    );

    return (
      <form
        {...props}
        ref={ref}
        // A submit before the page's script runs posts to the page itself and
        // never puts what the visitor typed into the address bar.
        method="post"
        noValidate={false}
        onSubmit={handleSubmit}
      >
        <CanvasCheck title="Signup Form" problems={problems} />
        <FormRootContext.Provider value={root}>
          {children}
        </FormRootContext.Provider>
        <input
          ref={honeypotRef}
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          defaultValue=""
          style={honeypotStyle}
        />
      </form>
    );
  }
);

SignupForm.displayName = "SignupForm";
