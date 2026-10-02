import { useMemo } from "react";
import { computed } from "nanostores";
import { useStore } from "@nanostores/react";
import type { WsComponentMeta } from "@webstudio-is/sdk";
import type { GeneratedTemplateMeta } from "@webstudio-is/template";
import {
  theme,
  ComponentCard,
  Flex,
  Link,
  List,
  ListItem,
  PanelTitle,
  ScrollArea,
  Separator,
  Text,
} from "@webstudio-is/design-system";
import type { Publish } from "~/shared/pubsub";
import {
  $organizeosSite,
  $registeredComponentMetas,
  $registeredTemplates,
  $selectedPage,
} from "~/shared/nano-states";
import type { OrganizeosSite } from "~/shared/organizeos-site";
import { platformName, platformUrl } from "~/shared/branding";
import { CollapsibleSection } from "~/builder/shared/collapsible-section";
import {
  getInstanceLabel,
  InstanceIcon,
} from "~/builder/shared/instance-label";
import {
  dragItemAttribute,
  useDraggable,
} from "~/builder/features/components/use-draggable";
import {
  insertOrganizeosBlock,
  organizeosNamespace,
} from "./insert-organizeos-block";

/**
 * The OrganizeOS panel (spec section 3.1): the blocks registered under the
 * @organizeos/site-components namespace, in sections. Their metas are hidden,
 * so the Components panel never lists them; this one does, and inserts each
 * through insertOrganizeosBlock so it arrives bound to the project's data.
 */

type Section = {
  label: string;
  /** Block names without the namespace, in the order they are listed. */
  blocks: string[];
  /** The workspace area where the org makes what these blocks act on. */
  area?: { label: string; path: string };
};

// Signups, Events, Membership and Donations in the spec; Phase 1 ships the
// Signup Form.
const sections: Section[] = [
  {
    label: "Signups",
    blocks: ["SignupForm"],
    // The workspace's Embeds hub, where the org makes its signup forms.
    area: { label: `Manage forms in ${platformName}`, path: "pages/embeds" },
  },
];

type Block = {
  name: string;
  label: string;
  description: undefined | string;
  icon: undefined | string;
  firstInstance: { component: string; tag?: string };
};

export type BlockSection = {
  label: string;
  area?: Section["area"];
  blocks: Block[];
};

export const groupOrganizeosBlocks = (
  templates: Map<string, GeneratedTemplateMeta>,
  metas: Map<string, WsComponentMeta>
): BlockSection[] => {
  const prefix = `${organizeosNamespace}:`;
  const toBlock = (name: string, meta: GeneratedTemplateMeta): Block => ({
    name,
    label:
      meta.label ??
      metas.get(name)?.label ??
      getInstanceLabel({ component: name }),
    description: meta.description,
    icon: meta.icon,
    firstInstance: meta.template.instances[0],
  });
  const listed = new Set<string>();
  const grouped: BlockSection[] = sections.map(({ label, area, blocks }) => {
    const sectionBlocks: Block[] = [];
    for (const block of blocks) {
      const name = `${prefix}${block}`;
      const meta = templates.get(name);
      if (meta !== undefined) {
        sectionBlocks.push(toBlock(name, meta));
        listed.add(name);
      }
    }
    return { label, area, blocks: sectionBlocks };
  });
  // A block no section names yet is still offered, after the others.
  const unlisted = [...templates].filter(
    ([name]) => name.startsWith(prefix) && listed.has(name) === false
  );
  if (unlisted.length > 0) {
    grouped.push({
      label: "More",
      blocks: unlisted.map(([name, meta]) => toBlock(name, meta)),
    });
  }
  return grouped.filter((section) => section.blocks.length > 0);
};

/**
 * A link into the org's workspace on the app host,
 * <platform URL>/<subdomain>/<path>, beside the Website area the builder's
 * menu links to (<platform URL>/<subdomain>/website). Without a known
 * subdomain it is the Website area's own URL, which is then the platform
 * dashboard; for a project no org owns, the platform home.
 */
export const getWorkspaceAreaUrl = (
  site: undefined | OrganizeosSite,
  path: string
) => {
  if (site === undefined) {
    return platformUrl;
  }
  if (site.subdomain === undefined) {
    return site.manageUrl;
  }
  return `${site.platformUrl}/${site.subdomain}/${path}`;
};

const $blockSections = computed(
  [$registeredTemplates, $registeredComponentMetas],
  groupOrganizeosBlocks
);

export const OrganizeosPanel = ({
  publish,
  onClose,
}: {
  publish: Publish;
  onClose: () => void;
}) => {
  const blockSections = useStore($blockSections);
  const site = useStore($organizeosSite);
  const selectedPage = useStore($selectedPage);
  const availableComponents = useMemo(
    () =>
      new Set(
        blockSections.flatMap((section) =>
          section.blocks.map((block) => block.name)
        )
      ),
    [blockSections]
  );
  const { dragCard, draggableContainerRef, isDragging } = useDraggable({
    publish,
    availableComponents,
  });

  const handleInsert = (component: string) => {
    void insertOrganizeosBlock(component);
    onClose();
  };

  return (
    <>
      <PanelTitle>{platformName}</PanelTitle>
      <Separator />

      {selectedPage?.meta.documentType === "xml" ? (
        <Text color="subtle" css={{ padding: theme.panel.padding }}>
          {platformName} blocks go on HTML pages.
        </Text>
      ) : (
        <ScrollArea ref={draggableContainerRef}>
          {blockSections.map((section) => (
            <CollapsibleSection
              label={section.label}
              key={section.label}
              fullWidth
            >
              <List asChild>
                <Flex
                  gap="1"
                  wrap="wrap"
                  css={{
                    paddingInline: theme.panel.paddingInline,
                    overflow: "auto",
                  }}
                >
                  {section.blocks.map((block, index) => (
                    <ListItem
                      asChild
                      index={index}
                      key={block.name}
                      onSelect={() => handleInsert(block.name)}
                    >
                      <ComponentCard
                        {...{ [dragItemAttribute]: block.name }}
                        // the Components panel's card width: three to a row
                        css={{ width: 69 }}
                        label={block.label}
                        description={block.description}
                        disableTooltip={isDragging}
                        icon={
                          <InstanceIcon
                            size="auto"
                            instance={block.firstInstance}
                            icon={block.icon}
                          />
                        }
                      />
                    </ListItem>
                  ))}
                </Flex>
              </List>
              {section.area && (
                <Text
                  color="subtle"
                  css={{ paddingInline: theme.panel.paddingInline }}
                >
                  <Link
                    href={getWorkspaceAreaUrl(site, section.area.path)}
                    target="_blank"
                    rel="noreferrer"
                    color="inherit"
                    variant="inherit"
                  >
                    {section.area.label}
                  </Link>
                </Text>
              )}
            </CollapsibleSection>
          ))}
          {dragCard}
        </ScrollArea>
      )}
    </>
  );
};
