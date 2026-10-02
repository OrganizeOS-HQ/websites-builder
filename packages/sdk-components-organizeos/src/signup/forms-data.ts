import type { FormFieldConfig } from "../form/context";

/**
 * The fields a Signup Form collects with no form picked, as the platform
 * applies them: email required; first name, last name and phone optional.
 */
export const orgDefaultFields: readonly FormFieldConfig[] = [
  {
    name: "email",
    label: "Email",
    type: "email",
    required: true,
    options: null,
  },
  {
    name: "first_name",
    label: "First name",
    type: "text",
    required: false,
    options: null,
  },
  {
    name: "last_name",
    label: "Last name",
    type: "text",
    required: false,
    options: null,
  },
  {
    name: "phone",
    label: "Phone",
    type: "phone",
    required: false,
    options: null,
  },
];

type FormRecord = {
  id: string;
  kind: string;
  fields: FormFieldConfig[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Array.isArray(value) === false;

// Lenient by design: a published site freezes this code while the platform's
// DTO can gain fields, so unknown keys are ignored and only what the block
// needs is read.
const parseField = (value: unknown): FormFieldConfig | undefined => {
  if (isRecord(value) === false || typeof value.name !== "string") {
    return;
  }
  const options = Array.isArray(value.options)
    ? value.options.filter((option) => typeof option === "string")
    : null;
  return {
    name: value.name,
    label: typeof value.label === "string" ? value.label : value.name,
    type: typeof value.type === "string" ? value.type : "text",
    required: value.required === true,
    options,
  };
};

const parseForm = (value: unknown): FormRecord | undefined => {
  if (
    isRecord(value) === false ||
    typeof value.id !== "string" ||
    Array.isArray(value.fields) === false
  ) {
    return;
  }
  const fields: FormFieldConfig[] = [];
  for (const item of value.fields) {
    const field = parseField(item);
    if (field) {
      fields.push(field);
    }
  }
  return {
    id: value.id,
    kind: typeof value.kind === "string" ? value.kind : "",
    fields,
  };
};

/**
 * Reads the `GET /v1/forms` body, `{ data: Form[] }`. Undefined when the value
 * is missing or is not that shape (the preset failed to load, or is unbound).
 */
export const parseFormsData = (data: unknown): FormRecord[] | undefined => {
  if (isRecord(data) === false || Array.isArray(data.data) === false) {
    return;
  }
  const forms: FormRecord[] = [];
  for (const item of data.data) {
    const form = parseForm(item);
    if (form) {
      forms.push(form);
    }
  }
  return forms;
};

export type SignupFormResolution = {
  /** The form id to send, undefined for the org defaults. */
  formId: string | undefined;
  /** The fields the block collects, undefined when its form is unknown. */
  fields: readonly FormFieldConfig[] | undefined;
  /**
   * Why the block cannot submit, undefined when it can. Only a picked form
   * can be unavailable:
   * - "data": a form is picked and the Forms data is missing or malformed;
   * - "record": the picked form is not in it (unpublished, deleted, or a form
   *   the platform does not offer here);
   * - "kind": the picked form is a membership form, which the signups endpoint
   *   refuses; it belongs to the Join Form.
   */
  unavailable: undefined | "data" | "record" | "kind";
};

/** Finds the block's form in the Forms data by `record`, or uses the org defaults. */
export const resolveSignupForm = (
  record: unknown,
  data: unknown
): SignupFormResolution => {
  const formId =
    typeof record === "string" && record.trim() !== ""
      ? record.trim()
      : undefined;
  // With no form picked, the Forms data is not read at all: the org defaults
  // need nothing from it, and the endpoint resolves the org from the host.
  if (formId === undefined) {
    return {
      formId: undefined,
      fields: orgDefaultFields,
      unavailable: undefined,
    };
  }
  const forms = parseFormsData(data);
  if (forms === undefined) {
    return { formId, fields: undefined, unavailable: "data" };
  }
  const form = forms.find((item) => item.id === formId);
  if (form === undefined) {
    return { formId, fields: undefined, unavailable: "record" };
  }
  return {
    formId,
    fields: form.fields,
    unavailable: form.kind === "membership" ? "kind" : undefined,
  };
};
