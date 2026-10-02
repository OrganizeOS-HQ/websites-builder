import { describe, expect, test } from "vitest";
import { enableMapSet } from "immer";
import type { Project } from "@webstudio-is/project";
import { createDefaultPages } from "@webstudio-is/project-build";
import * as defaultMetas from "@webstudio-is/sdk-components-react/metas";
import { coreMetas, type Instance, type Resource } from "@webstudio-is/sdk";
import * as organizeosMetas from "@organizeos/site-components/metas";
import * as organizeosTemplates from "@organizeos/site-components/templates";
// The body of GET /v1/forms, the platform's contract fixture.
import formsBody from "../../../../../../../packages/sdk-components-organizeos/src/__fixtures__/forms.json";
import {
  $registeredComponentMetas,
  $selectedInstanceKey,
  getInstanceKey,
  registerComponentLibrary,
  selectInstance,
} from "~/shared/nano-states";
import { $selectedPageId } from "~/shared/nano-states/pages";
import { registerContainers } from "~/shared/sync/sync-stores";
import {
  $assets,
  $breakpoints,
  $dataSources,
  $instances,
  $pages,
  $project,
  $props,
  $resources,
  $styleSourceSelections,
  $styleSources,
  $styles,
} from "~/shared/sync/data-stores";
import {
  $resourcesCache,
  computeResourceRequest,
  getResourceKey,
} from "~/shared/resources";
import { buildOrgResourcePresets } from "~/shared/db/resource-presets.server";
import {
  getOrganizeosPresetIds,
  insertOrganizeosBlock,
} from "~/builder/features/organizeos-panel/insert-organizeos-block";
import { renderControl } from "./combined";
import { TextControl } from "./text";
import {
  $selectedInstanceDataProp,
  OrganizeosRecordControl,
  getOrganizeosRecordOptions,
  isOrganizeosRecordProp,
} from "./organizeos-record";

enableMapSet();
registerContainers();

$registeredComponentMetas.set(
  new Map(Object.entries({ ...defaultMetas, ...coreMetas }))
);
registerComponentLibrary({
  namespace: "@organizeos/site-components",
  components: {},
  metas: organizeosMetas,
  templates: organizeosTemplates,
});

const signupForm = "@organizeos/site-components:SignupForm";
const [newsletter, contactForm, membershipForm] = formsBody.data;

const none = { value: "", label: "None (org defaults)" };
const newsletterOption = {
  value: newsletter.id,
  label: "Newsletter (Newsletter)",
};
const contactOption = {
  value: contactForm.id,
  label: "Get in touch (Contact)",
};
const unavailable = (value: string) => ({ value, label: "Unavailable form" });

describe("isOrganizeosRecordProp", () => {
  test("is true for record on the Signup Form", () => {
    expect(isOrganizeosRecordProp(signupForm, "record")).toBe(true);
  });

  test.each([
    ["record on Box", "Box", "record"],
    [
      "record on another library's component",
      "@webstudio-is/sdk-components-react-radix:Select",
      "record",
    ],
    ["record on a SignupForm outside the namespace", "SignupForm", "record"],
    ["data on the Signup Form", signupForm, "data"],
    ["action on the Signup Form", signupForm, "action"],
    [
      "record on an OrganizeOS component the picker has no kinds for",
      "@organizeos/site-components:Field",
      "record",
    ],
    [
      "record on an unknown OrganizeOS component",
      "@organizeos/site-components:JoinForm",
      "record",
    ],
    ["record on an instance that is not there", undefined, "record"],
  ])("is false for %s", (_case, component, propName) => {
    expect(isOrganizeosRecordProp(component, propName)).toBe(false);
  });
});

describe("renderControl", () => {
  test("gives the Signup Form's record the picker, and record anywhere else the text control", () => {
    const instance = (id: string, component: string): [string, Instance] => [
      id,
      { type: "instance", id, component, children: [] },
    ];
    $instances.set(
      new Map([
        instance("form", signupForm),
        instance("box", "Box"),
        instance("field", "@organizeos/site-components:Field"),
      ])
    );
    const getControl = (instanceId: string, propName: string) =>
      renderControl({
        instanceId,
        meta: { type: "string", control: "text", required: false },
        prop: undefined,
        propName,
        computedValue: undefined,
        onChange: () => {},
      })?.type;

    expect(getControl("form", "record")).toBe(OrganizeosRecordControl);
    expect(getControl("form", "actionPage")).toBe(TextControl);
    expect(getControl("box", "record")).toBe(TextControl);
    expect(getControl("field", "record")).toBe(TextControl);
    expect(getControl("missing", "record")).toBe(TextControl);
  });
});

describe("getOrganizeosRecordOptions", () => {
  test("lists None first, then the newsletter and the contact form, and not the membership form", () => {
    const { options, selected, hasData } = getOrganizeosRecordOptions(
      signupForm,
      formsBody,
      undefined
    );

    expect(options).toEqual([none, newsletterOption, contactOption]);
    expect(options.some((option) => option.value === membershipForm.id)).toBe(
      false
    );
    expect(selected).toEqual(none);
    expect(hasData).toBe(true);
  });

  test("selects the form the record names", () => {
    expect(
      getOrganizeosRecordOptions(signupForm, formsBody, contactForm.id)
    ).toEqual({
      options: [none, newsletterOption, contactOption],
      selected: contactOption,
      hasData: true,
    });
  });

  test("reads the record as the block does: trimmed, and the org defaults when empty or not a string", () => {
    for (const record of [undefined, null, "", "  ", 42, { id: "x" }]) {
      expect(getOrganizeosRecordOptions(signupForm, formsBody, record)).toEqual(
        {
          options: [none, newsletterOption, contactOption],
          selected: none,
          hasData: true,
        }
      );
    }
    expect(
      getOrganizeosRecordOptions(signupForm, formsBody, ` ${newsletter.id} `)
        .selected
    ).toEqual(newsletterOption);
  });

  test.each([
    ["is not in the data", "00000000-0000-4000-8000-000000000000"],
    ["is a kind the block does not take", membershipForm.id],
  ])("keeps a record that %s as Unavailable form", (_case, record) => {
    expect(getOrganizeosRecordOptions(signupForm, formsBody, record)).toEqual({
      options: [none, unavailable(record), newsletterOption, contactOption],
      selected: unavailable(record),
      hasData: true,
    });
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["{}", {}],
    [`{ data: "x" }`, { data: "x" }],
    ["{ data: {} }", { data: {} }],
    ["an array", formsBody.data],
    ["the loader's error body", { error: "unauthorized" }],
  ])(
    "with no data (%s), gives None alone, plus the current value",
    (_case, data) => {
      expect(getOrganizeosRecordOptions(signupForm, data, "")).toEqual({
        options: [none],
        selected: none,
        hasData: false,
      });
      expect(
        getOrganizeosRecordOptions(signupForm, data, newsletter.id)
      ).toEqual({
        options: [none, unavailable(newsletter.id)],
        selected: unavailable(newsletter.id),
        hasData: false,
      });
    }
  );

  test("skips entries without an id, and gives None alone when that is all of them", () => {
    const withoutIds = {
      data: formsBody.data.map(({ id: _id, ...form }) => form),
    };
    expect(getOrganizeosRecordOptions(signupForm, withoutIds, "")).toEqual({
      options: [none],
      selected: none,
      hasData: true,
    });
    expect(
      getOrganizeosRecordOptions(signupForm, withoutIds, newsletter.id)
    ).toEqual({
      options: [none, unavailable(newsletter.id)],
      selected: unavailable(newsletter.id),
      hasData: true,
    });
  });

  test("skips what the block cannot use, without throwing", () => {
    const data = {
      data: [
        null,
        "form",
        42,
        [],
        { ...newsletter, id: 7 },
        { ...newsletter, id: "" },
        { ...newsletter, id: " padded " },
        { ...newsletter, id: "no-fields", fields: undefined },
        { ...newsletter, id: "unknown-kind", kind: "survey" },
        { ...newsletter, id: "no-kind", kind: undefined },
        newsletter,
        // the block takes the first form with an id, so a second is skipped
        { ...newsletter, name: "A second copy" },
        { ...contactForm, name: undefined },
      ],
    };

    expect(getOrganizeosRecordOptions(signupForm, data, "")).toEqual({
      options: [
        none,
        newsletterOption,
        { value: contactForm.id, label: "Untitled form (Contact)" },
      ],
      selected: none,
      hasData: true,
    });
  });
});

describe("an inserted Signup Form", () => {
  test("lists the org's forms once the builder's loader has them", async () => {
    const projectId = "project-1";
    const { forms } = await getOrganizeosPresetIds(projectId);
    const provisioned = await buildOrgResourcePresets({
      projectId,
      apiBaseUrl: "https://staging.example.org/api/public/v1",
      readToken: "osk_eventstoken",
    });
    // as provisioning seeds a project: the first Signup Form adds Forms
    $resources.set(
      new Map(
        provisioned.resources
          .filter((resource) => resource.id !== forms.resourceId)
          .map((resource) => [resource.id, resource])
      )
    );
    $dataSources.set(
      new Map(
        provisioned.dataSources
          .filter((dataSource) => dataSource.id !== forms.bindingId)
          .map((dataSource) => [dataSource.id, dataSource])
      )
    );
    $instances.set(
      new Map([
        [
          "bodyId",
          { type: "instance", id: "bodyId", component: "Body", children: [] },
        ],
      ])
    );
    $props.set(new Map());
    $breakpoints.set(new Map());
    $styles.set(new Map());
    $styleSources.set(new Map());
    $styleSourceSelections.set(new Map());
    $assets.set(new Map());
    const pages = createDefaultPages({ rootInstanceId: "bodyId" });
    $pages.set(pages);
    $selectedPageId.set(pages.homePageId);
    selectInstance(["bodyId"]);
    $project.set({ id: projectId } as Project);
    $resourcesCache.set(new Map());

    expect(await insertOrganizeosBlock(signupForm)).toBe(true);

    // insert selects the block, and the picker reads its computed data
    const roots = [...$instances.get().values()].filter(
      (instance) => instance.component === signupForm
    );
    expect(roots).toHaveLength(1);
    expect($selectedInstanceKey.get()).toBe(
      getInstanceKey([roots[0].id, "bodyId"])
    );
    // until the loader has the forms: None alone, and the hint
    expect($selectedInstanceDataProp.get()).toBeUndefined();
    expect(
      getOrganizeosRecordOptions(
        signupForm,
        $selectedInstanceDataProp.get(),
        ""
      )
    ).toEqual({ options: [none], selected: none, hasData: false });

    const request = computeResourceRequest(
      $resources.get().get(forms.resourceId) as Resource,
      new Map()
    );
    $resourcesCache.set(
      new Map([
        [
          getResourceKey(request),
          { ok: true, status: 200, statusText: "", data: formsBody },
        ],
      ])
    );

    expect($selectedInstanceDataProp.get()).toEqual(formsBody);
    expect(
      getOrganizeosRecordOptions(
        signupForm,
        $selectedInstanceDataProp.get(),
        ""
      )
    ).toEqual({
      options: [none, newsletterOption, contactOption],
      selected: none,
      hasData: true,
    });
  });
});
