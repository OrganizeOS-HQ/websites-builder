import type { FunctionComponent } from "react";
import { useStore } from "@nanostores/react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  Grid,
  theme,
  ScrollArea,
  Flex,
  List,
  ListItem,
  Text,
  rawTheme,
} from "@webstudio-is/design-system";
import { SpinnerIcon } from "@webstudio-is/icons";
import {
  $openProjectSettings,
  type SectionName,
} from "~/shared/nano-states/project-settings";
import { $isDesignMode } from "~/shared/nano-states";
import { leftPanelWidth, rightPanelWidth } from "./utils";
import { SectionGeneral } from "./section-general";
import { SectionAuth } from "./section-auth";
import { SectionRedirects } from "./section-redirects";
import { SectionPublish } from "./section-publish";
import { SectionBackups } from "./section-backups";
import { titleCase } from "title-case";

// OrganizeOS fork: no "marketplace" section. Upstream's submits the project to
// the Webstudio template marketplace for review; this deployment has no
// marketplace and no reviewer, so the section offered an action that goes
// nowhere and flipped marketplaceApprovalStatus on the way.
const sections = new Map<
  SectionName,
  FunctionComponent<{ projectId?: string }>
>([
  ["general", SectionGeneral],
  ["redirects", SectionRedirects],
  ["publish", SectionPublish],
  ["backups", SectionBackups],
  ["auth", SectionAuth],
] as const);

const sectionLabels = new Map<SectionName, string>([
  ["auth", "Authentication"],
]);

export const ProjectSettingsDialog = ({
  currentSection,
  onSectionChange,
  onOpenChange,
  projectId,
  status = "loaded",
}: {
  currentSection?: SectionName;
  onSectionChange?: (section: SectionName) => void;
  onOpenChange?: (isOpen: boolean) => void;
  projectId?: string;
  status?: "idle" | "loading" | "loaded";
}) => {
  const isDesignMode = useStore($isDesignMode);
  const SectionComponent = currentSection
    ? sections.get(currentSection)
    : undefined;

  return (
    <Dialog
      draggable
      open={sections.has(currentSection!)}
      onOpenChange={onOpenChange}
    >
      <DialogContent
        width={
          Number.parseInt(leftPanelWidth, 10) +
          Number.parseInt(rightPanelWidth, 10)
        }
        height={Number.parseInt(rawTheme.spacing[35], 10)}
        data-floating-panel-container
      >
        <fieldset style={{ display: "contents" }} disabled={!isDesignMode}>
          <Flex grow>
            <List asChild>
              <Flex
                direction="column"
                shrink={false}
                css={{
                  width: leftPanelWidth,
                  borderRight: `1px solid  ${theme.colors.borderMain}`,
                }}
              >
                {Array.from(sections.keys()).map((name, index) => {
                  return (
                    <ListItem
                      current={currentSection === name}
                      asChild
                      index={index}
                      key={name}
                      onSelect={() => {
                        onSectionChange?.(name);
                      }}
                    >
                      <Flex
                        css={{
                          position: "relative",
                          height: theme.spacing[13],
                          paddingInline: theme.panel.paddingInline,
                          outline: "none",
                          "&:focus-visible, &:hover": {
                            background: theme.colors.backgroundHover,
                          },
                          "&[aria-current=true]": {
                            background: theme.colors.backgroundItemCurrent,
                            color: theme.colors.foregroundMain,
                          },
                        }}
                        align="center"
                      >
                        <Text variant="labels" truncate>
                          {sectionLabels.get(name) ?? titleCase(name)}
                        </Text>
                      </Flex>
                    </ListItem>
                  );
                })}
              </Flex>
            </List>
            <ScrollArea css={{ width: "100%" }}>
              {status === "loading" ? (
                <Flex justify="center" align="center" css={{ minHeight: 400 }}>
                  <SpinnerIcon size={rawTheme.spacing[15]} />
                </Flex>
              ) : (
                <Grid gap={2} css={{ paddingBlock: theme.spacing[5] }}>
                  {SectionComponent && (
                    <SectionComponent projectId={projectId} />
                  )}
                </Grid>
              )}
            </ScrollArea>
          </Flex>
          {/* Title is at the end intentionally,
           * to make the close button last in the tab order
           */}
          <DialogTitle>Project settings</DialogTitle>
        </fieldset>
      </DialogContent>
    </Dialog>
  );
};

export const ProjectSettings = () => {
  const currentSection = useStore($openProjectSettings);

  return (
    <ProjectSettingsDialog
      currentSection={currentSection}
      onSectionChange={$openProjectSettings.set}
      onOpenChange={(open) => {
        $openProjectSettings.set(open ? "general" : undefined);
      }}
    />
  );
};
