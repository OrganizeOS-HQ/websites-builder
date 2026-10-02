import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  type ComponentProps,
  type ElementRef,
  type ReactNode,
} from "react";
import {
  FormRootContext,
  useRegisterPart,
  type FormFieldConfig,
} from "../form/context";
import { useMergedRef } from "../form/merge-ref";

type FieldContextValue = {
  name: string;
  /** The form's config for this field, undefined when the form lacks it. */
  config: FormFieldConfig | undefined;
  inputId: string;
  messageId: string;
  error: string | undefined;
};

const FieldContext = createContext<FieldContextValue | undefined>(undefined);

type FieldProps = ComponentProps<"div"> & {
  /** The form field's name, as the form names it (email, first_name, ...). */
  field?: string;
};

/**
 * Field: names one form field and wires its Label, Input and Message
 * together (`for`, `id`, `aria-describedby`, `aria-invalid`).
 */
export const Field = forwardRef<ElementRef<"div">, FieldProps>(
  ({ field, children, ...props }, ref) => {
    const root = useContext(FormRootContext);
    const id = useId();
    const name = typeof field === "string" ? field.trim() : "";
    useRegisterPart({ kind: "field", name });
    const config = root?.fields?.find((item) => item.name === name);
    const error = root?.fieldErrors.get(name);
    const value = useMemo(
      () => ({
        name,
        config,
        inputId: `${id}input`,
        messageId: `${id}message`,
        error,
      }),
      [name, config, id, error]
    );
    return (
      <div {...props} ref={ref}>
        <FieldContext.Provider value={value}>{children}</FieldContext.Provider>
      </div>
    );
  }
);

Field.displayName = "Field";

/** Field Label: the field's label; its text is the designer's. */
export const FieldLabel = forwardRef<
  ElementRef<"label">,
  ComponentProps<"label">
>(({ children, ...props }, ref) => {
  const field = useContext(FieldContext);
  return (
    <label {...props} htmlFor={field?.inputId ?? props.htmlFor} ref={ref}>
      {children}
    </label>
  );
});

FieldLabel.displayName = "FieldLabel";

const autoCompleteByName: Record<string, string> = {
  email: "email",
  first_name: "given-name",
  last_name: "family-name",
  name: "name",
  phone: "tel",
};

const getAutoComplete = (name: string, type: string) => {
  if (Object.hasOwn(autoCompleteByName, name)) {
    return autoCompleteByName[name];
  }
  if (type === "email") {
    return "email";
  }
  if (type === "phone" || type === "tel") {
    return "tel";
  }
};

type InputElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** A checkbox sends "true" when checked and "" when not, as Website Lite does. */
const readInputValue = (element: InputElement | null) => {
  if (element === null) {
    return "";
  }
  // only an input's type is "checkbox"; a textarea's is "textarea", a select's "select-one"
  if (element.type === "checkbox") {
    return (element as HTMLInputElement).checked ? "true" : "";
  }
  return element.value;
};

type FieldInputProps = Omit<ComponentProps<"input">, "children"> & {
  children?: ReactNode;
};

/**
 * Field Input: the input its field's type calls for (a text, email or phone
 * input, a textarea, a select with the form's options, or a checkbox), named
 * and required as the form says. The designer's attributes (placeholder,
 * classes) pass through; name, type, id and required are the form's.
 */
export const FieldInput = forwardRef<InputElement, FieldInputProps>(
  (
    // children never reach a void element, the field decides the type, and
    // values stay uncontrolled
    {
      children: _children,
      type: _type,
      value,
      defaultValue,
      checked,
      defaultChecked,
      placeholder,
      ...props
    },
    forwardedRef
  ) => {
    const field = useContext(FieldContext);
    const elementRef = useRef<InputElement | null>(null);
    const ref = useMergedRef(forwardedRef, elementRef);
    const read = useCallback(() => readInputValue(elementRef.current), []);
    useRegisterPart(
      field === undefined
        ? undefined
        : { kind: "input", name: field.name, read }
    );
    const type = field?.config?.type ?? "text";
    const invalid = field?.error !== undefined;
    const common = {
      ...props,
      id: field?.inputId ?? props.id,
      name: field?.name ?? props.name,
      required: field?.config?.required === true,
      "aria-describedby": field?.messageId ?? props["aria-describedby"],
      "aria-invalid": invalid ? true : undefined,
      "data-invalid": invalid ? "" : undefined,
    };
    if (type === "textarea") {
      return (
        <textarea
          {...(common as ComponentProps<"textarea">)}
          placeholder={placeholder}
          defaultValue={value ?? defaultValue}
          ref={ref}
        />
      );
    }
    if (type === "select") {
      return (
        <select
          {...(common as ComponentProps<"select">)}
          defaultValue={value ?? defaultValue ?? ""}
          ref={ref}
        >
          <option value="">{placeholder ?? "Select..."}</option>
          {(field?.config?.options ?? []).map((option, index) => (
            <option key={index} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }
    if (type === "checkbox") {
      return (
        <input
          {...common}
          type="checkbox"
          value="true"
          defaultChecked={checked ?? defaultChecked}
          ref={ref}
        />
      );
    }
    const inputType =
      type === "email"
        ? "email"
        : type === "phone" || type === "tel"
          ? "tel"
          : "text";
    return (
      <input
        {...common}
        type={inputType}
        autoComplete={
          getAutoComplete(field?.name ?? "", type) ?? props.autoComplete
        }
        placeholder={placeholder}
        defaultValue={value ?? defaultValue}
        ref={ref}
      />
    );
  }
);

FieldInput.displayName = "FieldInput";

/**
 * Field Message: the field's error text after the platform refuses it; its
 * own children (a hint) otherwise. The input points at it with
 * `aria-describedby`.
 */
export const FieldMessage = forwardRef<
  ElementRef<"div">,
  ComponentProps<"div">
>(({ children, ...props }, ref) => {
  const field = useContext(FieldContext);
  const error = field?.error;
  return (
    <div
      {...props}
      id={field?.messageId ?? props.id}
      data-invalid={error === undefined ? undefined : ""}
      ref={ref}
    >
      {error ?? children}
    </div>
  );
});

FieldMessage.displayName = "FieldMessage";
