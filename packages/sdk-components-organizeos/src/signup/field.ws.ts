import {
  FormTextFieldIcon,
  ItemIcon,
  LabelIcon,
  TextIcon,
} from "@webstudio-is/icons/svg";
import type { WsComponentMeta } from "@webstudio-is/sdk";
import { div, input, label } from "@webstudio-is/sdk/normalize.css";
import { organizeos } from "../shared/meta";

export const metaField: WsComponentMeta = {
  category: "hidden",
  label: "Field",
  icon: ItemIcon,
  contentModel: {
    category: "none",
    children: ["instance"],
    descendants: [
      organizeos.FieldLabel,
      organizeos.FieldInput,
      organizeos.FieldMessage,
    ],
  },
  presetStyle: { div },
  initialProps: ["id", "class", "field"],
  props: {
    field: {
      type: "string",
      control: "text",
      required: true,
      label: "Form field",
      description:
        "The form field this Field collects, by its name in the form (email, first_name, last_name, phone, ...).",
    },
  },
};

export const metaFieldLabel: WsComponentMeta = {
  category: "hidden",
  label: "Field Label",
  icon: LabelIcon,
  contentModel: {
    category: "none",
    children: ["instance", "rich-text"],
  },
  presetStyle: { label },
  initialProps: ["id", "class"],
};

export const metaFieldInput: WsComponentMeta = {
  category: "hidden",
  label: "Field Input",
  icon: FormTextFieldIcon,
  contentModel: {
    category: "none",
    children: [],
  },
  states: [{ label: "Invalid", selector: "[data-invalid]" }],
  presetStyle: { input },
  initialProps: ["id", "class", "placeholder"],
};

export const metaFieldMessage: WsComponentMeta = {
  category: "hidden",
  label: "Field Message",
  icon: TextIcon,
  contentModel: {
    category: "none",
    children: ["instance", "rich-text"],
  },
  states: [{ label: "Invalid", selector: "[data-invalid]" }],
  presetStyle: { div },
  initialProps: ["id", "class"],
};
