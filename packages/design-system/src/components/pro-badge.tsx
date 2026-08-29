import type { ReactNode } from "react";
import { css, theme, type CSS } from "../stitches.config";
import { textVariants } from "./text";

const style = css(textVariants.labels, {
  display: "inline-grid",
  placeItems: "center",
  borderRadius: theme.borderRadius[3],
  px: theme.spacing[3],
  height: theme.spacing[9],
  color: theme.colors.foregroundContrastMain,
  alignItems: "center",
  maxWidth: "100%",
  whiteSpace: "nowrap",
  overflow: "hidden",
  // @todo doesn't work in tooltips, needs a workaround
  textOverflow: "ellipsis",
  background: theme.colors.foregroundTextSubtle,
  "@supports (text-box-trim: trim-both) and (text-box-edge: cap alphabetic)": {
    textBoxTrim: "trim-both",
    textBoxEdge: "cap alphabetic",
  },
});

/**
 * A plan badge. Upstream this linked to the Webstudio pricing page; plans here
 * are OrganizeOS org entitlements with no self-serve checkout, so the badge is
 * a label and nothing else.
 */
export const ProBadge = ({
  css,
  children,
}: {
  children: ReactNode;
  css?: CSS;
}) => {
  return <span className={style({ css })}>{children}</span>;
};
