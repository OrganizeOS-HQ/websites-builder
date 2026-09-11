import { atom } from "nanostores";

export type SectionName =
  | "general"
  | "auth"
  | "redirects"
  | "publish"
  | "backups";

export const $openProjectSettings = atom<SectionName | undefined>();
