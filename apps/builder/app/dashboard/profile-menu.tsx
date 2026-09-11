import { forwardRef } from "react";
import { ChevronDownIcon } from "@webstudio-is/icons";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  Avatar,
  theme,
  Button,
  DropdownMenuSeparator,
  Text,
  Flex,
} from "@webstudio-is/design-system";
import { useNavigate } from "@remix-run/react";
import { logoutPath } from "~/shared/router-utils";
import type { User } from "~/shared/db/user.server";

const getAvatarLetter = (title?: string) => {
  return (title || "X").charAt(0).toLocaleUpperCase();
};

const defaultUserName = "James Bond";

const ProfileButton = forwardRef<
  HTMLButtonElement,
  {
    name: string;
    image?: string;
  }
>(({ image, name, ...rest }, forwardedRef) => {
  return (
    <Flex gap="2" align="center">
      <Button
        color="ghost"
        aria-label="Profile Menu"
        {...rest}
        ref={forwardedRef}
        prefix={
          <Avatar src={image} fallback={getAvatarLetter(name)} alt={name} />
        }
        suffix={<ChevronDownIcon size={12} />}
        css={{
          // Exception for avatar. May need to introduce a 32px controls size later.
          height: theme.spacing[13],
        }}
      >
        {name && (
          <Text variant="labels" truncate>
            {name}
          </Text>
        )}
      </Button>
    </Flex>
  );
});

/**
 * OrganizeOS fork: no plan badge and no plans list. Plans here are org
 * entitlements resolved by OrganizeOS, so there are never Stripe purchases to
 * list, the badge labelled every single user "Free", and the per-purchase item
 * navigated to a billing-portal route this deployment does not serve.
 */
export const ProfileMenu = ({ user }: { user: User }) => {
  const navigate = useNavigate();
  const nameOrEmail = user.username ?? user.email ?? defaultUserName;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ProfileButton image={user.image || undefined} name={nameOrEmail} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width="regular">
        <DropdownMenuLabel>
          {user.username ?? defaultUserName}
          <Text>{user.email}</Text>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate(logoutPath())}>
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
