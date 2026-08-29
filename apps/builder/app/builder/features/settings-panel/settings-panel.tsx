import type { Instance } from "@webstudio-is/sdk";
import { SettingsSection } from "./settings-section";
import { PropsSectionContainer } from "./props-section/props-section";
import { VariablesSection } from "./variables-section";
import {
  Box,
  Flex,
  PanelBanner,
  Text,
  rawTheme,
  theme,
} from "@webstudio-is/design-system";
import { UpgradeIcon } from "@webstudio-is/icons";
import { useStore } from "@nanostores/react";
import cmsUpgradeBanner from "~/shared/cms-upgrade-banner.svg?url";
import { $isDesignMode, $permissions } from "~/shared/nano-states";
import { planUpgradeHint } from "~/shared/branding";

export const SettingsPanel = ({
  selectedInstance,
  selectedInstanceKey,
}: {
  selectedInstance: Instance;
  selectedInstanceKey: string;
}) => {
  const { allowDynamicData } = useStore($permissions);
  const isDesignMode = useStore($isDesignMode);

  return (
    <Box css={{ pt: theme.spacing[5] }}>
      <SettingsSection />

      <PropsSectionContainer
        selectedInstance={selectedInstance}
        selectedInstanceKey={selectedInstanceKey}
      />

      {isDesignMode && <VariablesSection />}

      {allowDynamicData === false && (
        <PanelBanner>
          <img
            src={cmsUpgradeBanner}
            alt="CMS"
            width={rawTheme.spacing[28]}
            style={{ aspectRatio: "4.1" }}
          />
          <Text variant="regularBold">
            CMS on custom domains is not included in your plan
          </Text>
          <Text>
            Integrate content from other tools to create blogs, directories, and
            any other structured content. You can preview CMS on staging on any
            plan.
          </Text>
          <Flex align="center" gap={1}>
            <UpgradeIcon />
            <Text>{planUpgradeHint}</Text>
          </Flex>
        </PanelBanner>
      )}
    </Box>
  );
};
