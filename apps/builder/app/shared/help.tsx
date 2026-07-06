import {
  ContentIcon,
  DiscordIcon,
  GithubIcon,
  YoutubeIcon,
  XLogoIcon,
  BlueskyIcon,
  FacebookIcon,
  LinkedinIcon,
  RedditIcon,
} from "@webstudio-is/icons";

export const socialLinks = [
  { label: "X", url: "https://x.com/getwebstudio", icon: <XLogoIcon /> },
  {
    label: "Bluesky",
    url: "https://bsky.app/profile/webstudio.is",
    icon: <BlueskyIcon />,
  },
  {
    label: "Facebook",
    url: "https://www.facebook.com/webstudiois",
    icon: <FacebookIcon />,
  },
  {
    label: "LinkedIn",
    url: "https://www.linkedin.com/company/getwebstudio/",
    icon: <LinkedinIcon />,
  },
  {
    label: "Reddit",
    url: "https://www.reddit.com/r/webstudio/",
    icon: <RedditIcon />,
  },
] as const;

export const help = [
  {
    label: "Video tutorials",
    url: "https://wstd.us/101",
    icon: <YoutubeIcon />,
  },
  {
    label: "Docs",
    url: "https://docs.webstudio.is/",
    icon: <ContentIcon />,
  },
  {
    label: "Community",
    url: "https://wstd.us/community",
    icon: <DiscordIcon />,
  },
  // AGPL section 13 source offer: this builder is a fork of Webstudio and the
  // complete corresponding source lives in the public fork repository. Keep
  // this link present wherever the help list renders.
  {
    label: "Built on Webstudio (source code)",
    url: "https://github.com/OrganizeOS-HQ/websites-builder",
    icon: <GithubIcon />,
  },
] as const;
