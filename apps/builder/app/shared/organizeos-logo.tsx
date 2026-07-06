/**
 * The OrganizeOS product mark, used where upstream rendered the Webstudio logo
 * (login, builder topbar menu, loading screen, error page). Served from
 * /organizeos-icon.png in public/. Drop-in for WebstudioIcon's size prop.
 */
export const OrganizeosLogo = ({ size = 22 }: { size?: number }) => {
  return (
    <img
      src="/organizeos-icon.png"
      alt="OrganizeOS"
      width={size}
      height={size}
      style={{ display: "block" }}
    />
  );
};
