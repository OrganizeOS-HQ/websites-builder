import { useContext, type CSSProperties } from "react";
import { ReactSdkContext } from "@webstudio-is/react-sdk/runtime";

// Builder chrome, not designer content: fixed inline styles, so no style or
// token on the site changes how a warning reads.
const boxStyle: CSSProperties = {
  boxSizing: "border-box",
  margin: "0 0 8px",
  padding: "8px 12px",
  border: "1px solid #f59e0b",
  borderRadius: "4px",
  background: "#fffbeb",
  color: "#78350f",
  font: "12px/1.4 system-ui, sans-serif",
  textAlign: "left",
};

const titleStyle: CSSProperties = { fontWeight: 600 };

const listStyle: CSSProperties = { margin: "4px 0 0", paddingLeft: "16px" };

/**
 * The canvas check: a warning a root draws on itself while it lacks a part
 * it needs, or sits where it cannot work. Renders only on the builder's
 * canvas, so nothing of it reaches the preview or a published site.
 */
export const CanvasCheck = ({
  title,
  problems,
}: {
  title: string;
  problems: readonly string[];
}) => {
  const { renderer } = useContext(ReactSdkContext);
  if (renderer !== "canvas" || problems.length === 0) {
    return null;
  }
  return (
    <div data-organizeos-canvas-check="" style={boxStyle}>
      <div style={titleStyle}>{title} needs attention</div>
      <ul style={listStyle}>
        {problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
    </div>
  );
};
