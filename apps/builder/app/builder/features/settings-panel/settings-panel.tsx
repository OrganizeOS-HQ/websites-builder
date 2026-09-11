import type { Instance } from "@webstudio-is/sdk";
import { SettingsSection } from "./settings-section";
import { PropsSectionContainer } from "./props-section/props-section";
import { VariablesSection } from "./variables-section";
import { Box, PanelBanner, Text, theme } from "@webstudio-is/design-system";
import { useStore } from "@nanostores/react";
import { $isDesignMode, $permissions } from "~/shared/nano-states";
import { planUpgradeHint, platformName } from "~/shared/branding";

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

      {/* OrganizeOS fork: upstream sold its CMS here, with marketing artwork
          and a "CMS on custom domains / preview on staging on any plan" pitch.
          An OrganizeOS site has one address and no staging, so that sentence
          was simply untrue; this is the only plan gate an org can trip. */}
      {allowDynamicData === false && (
        <PanelBanner>
          <Text variant="regularBold">
            Binding external data is not included in your plan
          </Text>
          <Text>
            Data binding pulls live content from {platformName} into your site,
            so pages like events and donations stay current on their own.
          </Text>
          <Text>{planUpgradeHint}</Text>
        </PanelBanner>
      )}
    </Box>
  );
};
