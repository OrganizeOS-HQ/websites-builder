import { EmailIcon } from "@webstudio-is/icons/svg";
import type { WsComponentMeta } from "@webstudio-is/sdk";
import { form } from "@webstudio-is/sdk/normalize.css";
import { organizeos } from "../shared/meta";
import { signupFormStates } from "./states";

export const meta: WsComponentMeta = {
  category: "hidden",
  label: "Signup Form",
  description:
    "Signs visitors up to the organization through one of its forms, or the org defaults.",
  icon: EmailIcon,
  contentModel: {
    category: "instance",
    children: ["instance"],
    descendants: [organizeos.Field, organizeos.SubmitButton],
  },
  presetStyle: { form },
  initialProps: [
    "id",
    "class",
    "record",
    "data",
    "state",
    "action",
    "actionPage",
  ],
  props: {
    record: {
      type: "string",
      control: "text",
      required: false,
      label: "Form",
      description:
        "The form this block submits to, by its id. Leave it empty for the org defaults: email required; first name, last name and phone optional.",
    },
    data: {
      type: "json",
      control: "json",
      required: false,
      label: "Forms data",
      description:
        "The organization's published forms (the project's Forms data), where the block finds the form it submits to. Not read with the org defaults.",
    },
    state: {
      type: "string",
      control: "select",
      required: false,
      defaultValue: "initial",
      options: [...signupFormStates],
      description:
        "Reveals a state on the canvas so it can be styled. A published site starts in Initial and moves through the states as the visitor submits.",
    },
    action: {
      type: "string",
      control: "radio",
      required: false,
      defaultValue: "state",
      options: ["state", "page"],
      label: "After submit",
      description:
        "What happens after a successful signup: show the Success state, or go to a page.",
    },
    actionPage: {
      type: "string",
      control: "url",
      required: false,
      label: "Page",
      description:
        "The page to open after a successful signup, when After submit is page.",
    },
  },
};
