export const sidebarPanelNames = [
  "assets",
  "components",
  "navigator",
  "pages",
] as const;

export type SidebarPanelName = (typeof sidebarPanelNames)[number] | "none";
