import { ButtonElementIcon } from "@webstudio-is/icons/svg";
import type { WsComponentMeta } from "@webstudio-is/sdk";
import { button } from "@webstudio-is/sdk/normalize.css";

export const meta: WsComponentMeta = {
  category: "hidden",
  label: "Submit Button",
  icon: ButtonElementIcon,
  contentModel: {
    category: "none",
    children: ["instance", "rich-text"],
  },
  states: [{ label: "Submitting", selector: '[data-state="submitting"]' }],
  presetStyle: { button },
  initialProps: ["id", "class"],
};
