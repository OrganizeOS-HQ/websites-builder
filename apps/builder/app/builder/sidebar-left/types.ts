export const sidebarPanelNames = [
  "assets",
  "components",
  "navigator",
  // OrganizeOS fork: the OrganizeOS blocks panel.
  "organizeos",
  "pages",
] as const;

export type SidebarPanelName = (typeof sidebarPanelNames)[number] | "none";
