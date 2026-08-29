import { Flex, Text } from "@webstudio-is/design-system";
import { useStore } from "@nanostores/react";
import { Main } from "../shared/layout";
import { CreateProject } from "../projects/project-dialogs";
import { $permissions } from "~/shared/nano-states";

export const Welcome = ({
  currentWorkspaceId,
}: {
  currentWorkspaceId?: string;
}) => {
  const permissions = useStore($permissions);
  return (
    <Main>
      <Flex
        direction="column"
        align="center"
        grow
        gap="7"
        css={{ paddingBlock: "20vh" }}
      >
        <Text variant="brandMediumTitle" as="h3">
          Welcome!
        </Text>

        {/* OrganizeOS fork: the upstream template gallery and the Webstudio
            onboarding video are gone; creating a project is the only path
            offered here until we host our own. */}
        <Flex align="center" gap="3">
          {permissions.canCreateProject && (
            <CreateProject
              workspaceId={currentWorkspaceId}
              buttonText="Create a blank project"
            />
          )}
        </Flex>
      </Flex>
    </Main>
  );
};
