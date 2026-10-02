import { forwardRef } from "react";
import type { IconComponent } from "@webstudio-is/icons";

/**
 * The OrganizeOS product mark, used where upstream rendered the Webstudio logo
 * (login, builder topbar menu, loading screen, error page). Served from
 * /organizeos-icon.svg in public/ (vector, crisp at every size). Drop-in for WebstudioIcon's size prop.
 */
export const OrganizeosLogo = ({ size = 22 }: { size?: number }) => {
  return (
    <img
      src="/organizeos-icon.svg"
      alt="OrganizeOS"
      width={size}
      height={size}
      style={{ display: "block" }}
    />
  );
};

/**
 * The same mark as an icon (the path of /organizeos-icon.svg), for chrome that
 * takes @webstudio-is/icons components, such as the left sidebar's tabs. It
 * paints in currentColor like the icons beside it, and its padded viewBox puts
 * the mark in the 12px box those 16px line icons draw in.
 */
export const OrganizeosIcon: IconComponent = forwardRef(
  ({ fill = "currentColor", size = 16, ...props }, forwardedRef) => {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="-42.815 -42.815 342.52 342.52"
        width={size}
        height={size}
        fill={fill}
        {...props}
        ref={forwardedRef}
      >
        <path d="M198.52,0H58.37C26.13,0,0,26.13,0,58.37v140.15c0,32.23,26.13,58.37,58.37,58.37h140.15c32.24,0,58.37-26.13,58.37-58.37V58.37c0-32.23-26.13-58.37-58.37-58.37ZM230.36,230.36c-28.27,28.27-96.82,5.56-153.1-50.72C20.97,123.35-1.74,54.8,26.53,26.53c28.27-28.27,96.82-5.56,153.1,50.72,56.29,56.28,79,124.83,50.73,153.1Z" />
      </svg>
    );
  }
);
OrganizeosIcon.displayName = "OrganizeosIcon";
