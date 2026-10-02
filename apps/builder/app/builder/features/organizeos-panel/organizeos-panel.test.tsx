import { describe, expect, test } from "vitest";
import { renderTemplate, type TemplateMeta } from "@webstudio-is/template";
import type { WsComponentMeta } from "@webstudio-is/sdk";
import * as organizeosMetas from "@organizeos/site-components/metas";
import * as organizeosTemplates from "@organizeos/site-components/templates";
import { platformUrl } from "~/shared/branding";
import type { OrganizeosSite } from "~/shared/organizeos-site";
import { getWorkspaceAreaUrl, groupOrganizeosBlocks } from "./organizeos-panel";

const namespace = "@organizeos/site-components";

// What registerComponentLibrary puts in the registry for a library.
const register = (
  library: Record<string, TemplateMeta>,
  prefix: string
): Array<[string, ReturnType<typeof generate>]> =>
  Object.entries(library).map(([name, meta]) => [
    `${prefix}${name}`,
    generate(meta),
  ]);
const generate = ({ template, ...meta }: TemplateMeta) => ({
  ...meta,
  template: renderTemplate(template),
});

const metas = new Map<string, WsComponentMeta>(
  Object.entries(organizeosMetas).map(([name, meta]) => [
    `${namespace}:${name}`,
    meta,
  ])
);

describe("groupOrganizeosBlocks", () => {
  test("lists the namespace's templates in their sections, and nothing else", () => {
    const templates = new Map([
      ...register(organizeosTemplates, `${namespace}:`),
      ...register(
        { Sheet: organizeosTemplates.SignupForm },
        "@webstudio-is/sdk-components-react-radix:"
      ),
    ]);

    expect(groupOrganizeosBlocks(templates, metas)).toEqual([
      {
        label: "Signups",
        area: { label: "Manage forms in OrganizeOS", path: "pages/embeds" },
        blocks: [
          {
            name: `${namespace}:SignupForm`,
            label: "Signup Form",
            description: organizeosTemplates.SignupForm.description,
            icon: undefined,
            firstInstance: expect.objectContaining({
              component: `${namespace}:SignupForm`,
            }),
          },
        ],
      },
    ]);
  });

  test("still offers a block no section names, after the others", () => {
    const templates = new Map([
      ...register(organizeosTemplates, `${namespace}:`),
      ...register(
        { EventList: organizeosTemplates.SignupForm },
        `${namespace}:`
      ),
    ]);

    expect(
      groupOrganizeosBlocks(templates, metas).map((section) => [
        section.label,
        section.blocks.map((block) => block.name),
      ])
    ).toEqual([
      ["Signups", [`${namespace}:SignupForm`]],
      ["More", [`${namespace}:EventList`]],
    ]);
  });

  test("lists no section while the library is not registered", () => {
    expect(groupOrganizeosBlocks(new Map(), new Map())).toEqual([]);
  });
});

describe("getWorkspaceAreaUrl", () => {
  const site: OrganizeosSite = {
    organizationId: "org-1",
    subdomain: "acme",
    siteUrl: "https://acme.organizeos.org",
    manageUrl: "https://app.organizeos.org/acme/website",
    platformUrl: "https://app.organizeos.org",
  };

  test("links the org's workspace area on the app host", () => {
    expect(getWorkspaceAreaUrl(site, "pages/embeds")).toBe(
      "https://app.organizeos.org/acme/pages/embeds"
    );
  });

  test("falls back to the Website area's link while the subdomain is unknown", () => {
    expect(
      getWorkspaceAreaUrl(
        {
          ...site,
          subdomain: undefined,
          siteUrl: undefined,
          manageUrl: "https://app.organizeos.org/dashboard",
        },
        "pages/embeds"
      )
    ).toBe("https://app.organizeos.org/dashboard");
  });

  test("links the platform home for a project no org owns", () => {
    expect(getWorkspaceAreaUrl(undefined, "pages/embeds")).toBe(platformUrl);
  });
});
