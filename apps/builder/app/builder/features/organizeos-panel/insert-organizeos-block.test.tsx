import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { enableMapSet } from "immer";
import type { Project } from "@webstudio-is/project";
import { createDefaultPages } from "@webstudio-is/project-build";
import { $, renderData } from "@webstudio-is/template";
import * as defaultMetas from "@webstudio-is/sdk-components-react/metas";
import {
  ROOT_INSTANCE_ID,
  coreMetas,
  encodeDataSourceVariable,
  type DataSource,
  type Resource,
  type ResourceRequest,
} from "@webstudio-is/sdk";
import * as organizeosMetas from "@organizeos/site-components/metas";
import * as organizeosTemplates from "@organizeos/site-components/templates";
import {
  $propValuesByInstanceSelector,
  $registeredComponentMetas,
  $variableValuesByInstanceSelector,
  getInstanceKey,
  registerComponentLibrary,
  selectInstance,
  subscribeResources,
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
import { getComponentTemplateData } from "~/shared/instance-utils/insert";
import { instanceText } from "~/shared/copy-paste/plugin-instance";
import { emitCommand } from "~/builder/shared/commands";
import { buildOrgResourcePresets } from "~/shared/db/resource-presets.server";
import {
  completeOrganizeosFragment,
  getOrganizeosPresetIds,
  insertOrganizeosBlock,
} from "./insert-organizeos-block";

const { toastError, loaderFetch, beforeNextTransaction } = vi.hoisted(() => ({
  toastError: vi.fn(),
  // the builder's resources loader posts to /rest/resources-loader with this
  loaderFetch: vi.fn(),
  // runs once, just before the next transaction opens
  beforeNextTransaction: { run: undefined as undefined | (() => void) },
}));
vi.mock("~/shared/builder-api", () => ({
  builderApi: { toast: { error: toastError } },
}));
vi.mock("~/shared/fetch.client", () => ({ fetch: loaderFetch }));
// An edit can land between the insert's completion, which reads the stores,
// and the transaction that writes the preset; this opens that gap.
vi.mock("~/shared/instance-utils/data", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/shared/instance-utils/data")>();
  return {
    ...actual,
    updateWebstudioData: (
      ...args: Parameters<typeof actual.updateWebstudioData>
    ) => {
      const { run } = beforeNextTransaction;
      beforeNextTransaction.run = undefined;
      run?.();
      return actual.updateWebstudioData(...args);
    },
  };
});

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
const projectId = "project-1";
const refusal =
  "Cannot add Signup Form: this site's link to your organization's data was removed or changed. Contact OrganizeOS support to restore it.";

// Every preset provisioning builds for this project, Forms included, so the
// panel's view of a project is the real one.
const provisioned = await buildOrgResourcePresets({
  projectId,
  apiBaseUrl: "https://staging.example.org/api/public/v1",
  readToken: "osk_eventstoken",
});
const { events, forms } = await getOrganizeosPresetIds(projectId);
const formsResource = provisioned.resources.find(
  (resource) => resource.id === forms.resourceId
) as Resource;
const formsBinding = provisioned.dataSources.find(
  (dataSource) => dataSource.id === forms.bindingId
) as DataSource;
const eventsResource = provisioned.resources.find(
  (resource) => resource.id === events.resourceId
) as Resource;

// The Forms preset as both writers write it: scoped at :root, so it loads,
// and named so that a copy of a block is not rebound to a user's "Forms".
const scopedFormsResource: Resource = {
  id: forms.resourceId,
  name: "OrganizeOS Forms",
  method: "get",
  url: `"https://staging.example.org/api/public/v1/forms"`,
  headers: [{ name: "Authorization", value: `"Bearer osk_eventstoken"` }],
};
const scopedFormsBinding: DataSource = {
  type: "resource",
  id: forms.bindingId,
  scopeInstanceId: ROOT_INSTANCE_ID,
  name: "OrganizeOS Forms",
  resourceId: forms.resourceId,
};
// The Forms preset as it was written before it was scoped and renamed.
const unscopedFormsResource: Resource = {
  ...scopedFormsResource,
  name: "Forms",
};
const unscopedFormsBinding: DataSource = {
  type: "resource",
  id: forms.bindingId,
  name: "Forms",
  resourceId: forms.resourceId,
};

// An admin's own variables named "Forms", global and on the page.
const globalForms: DataSource = {
  type: "variable",
  id: "user-forms-global",
  scopeInstanceId: ROOT_INSTANCE_ID,
  name: "Forms",
  value: { type: "json", value: { data: [] } },
};
const pageForms: DataSource = {
  type: "variable",
  id: "user-forms-body",
  scopeInstanceId: "bodyId",
  name: "Forms",
  value: { type: "json", value: { data: [] } },
};

// A project as provisioning seeds it: the first Signup Form adds Forms.
const withoutForms = {
  resources: provisioned.resources.filter(
    (resource) => resource.id !== forms.resourceId
  ),
  dataSources: provisioned.dataSources.filter(
    (dataSource) => dataSource.id !== forms.bindingId
  ),
};

const setProject = ({
  resources,
  dataSources,
}: {
  resources: Resource[];
  dataSources: DataSource[];
}) => {
  const data = renderData(<$.Body ws:id="bodyId"></$.Body>);
  $instances.set(data.instances);
  $props.set(data.props);
  $breakpoints.set(new Map());
  $styles.set(new Map());
  $styleSources.set(new Map());
  $styleSourceSelections.set(new Map());
  $assets.set(new Map());
  $resources.set(new Map(resources.map((resource) => [resource.id, resource])));
  $dataSources.set(
    new Map(dataSources.map((dataSource) => [dataSource.id, dataSource]))
  );
  const pages = createDefaultPages({ rootInstanceId: "bodyId" });
  $pages.set(pages);
  $selectedPageId.set(pages.homePageId);
  selectInstance(["bodyId"]);
  $project.set({ id: projectId } as Project);
};

const getBlockDataProps = () => {
  const roots = [...$instances.get().values()].filter(
    (instance) => instance.component === signupForm
  );
  return roots.map((root) =>
    [...$props.get().values()].find(
      (prop) => prop.instanceId === root.id && prop.name === "data"
    )
  );
};

// Each block's `data` as the canvas renders it.
const getBlockDataValues = () => {
  const propValues = $propValuesByInstanceSelector.get();
  return getBlockDataProps().map((prop) =>
    propValues
      .get(getInstanceKey([prop?.instanceId ?? "", "bodyId"]))
      ?.get("data")
  );
};

// The value of the Forms preset in each block's variable scope, which the
// Settings panel's expression editor and Variables section read.
const getBlockScopeFormsValues = () => {
  const variableValues = $variableValuesByInstanceSelector.get();
  return getBlockDataProps().map((prop) =>
    variableValues
      .get(getInstanceKey([prop?.instanceId ?? "", "bodyId", ROOT_INSTANCE_ID]))
      ?.get(forms.bindingId)
  );
};

const boundToFormsPreset = {
  id: expect.any(String),
  instanceId: expect.any(String),
  name: "data",
  type: "expression",
  value: `${encodeDataSourceVariable(forms.bindingId)}.data`,
};

// GET /v1/forms's body, and the loader's result for it.
const formsBody = {
  data: [
    {
      id: "form-1",
      kind: "contact-signup",
      name: "Newsletter",
      fields: [
        {
          name: "email",
          label: "Email",
          type: "email",
          required: true,
          options: null,
        },
      ],
      opt_in: "single",
    },
  ],
};
const formsResult = { ok: true, status: 200, statusText: "", data: formsBody };

const getStores = () => ({
  instances: $instances.get(),
  props: $props.get(),
  dataSources: $dataSources.get(),
  resources: $resources.get(),
  styles: $styles.get(),
  styleSources: $styleSources.get(),
  styleSourceSelections: $styleSourceSelections.get(),
  breakpoints: $breakpoints.get(),
});

beforeEach(() => {
  toastError.mockClear();
  loaderFetch.mockReset();
  beforeNextTransaction.run = undefined;
  $resourcesCache.set(new Map());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("insertOrganizeosBlock", () => {
  test("binds an existing Forms preset by id, to the response body", async () => {
    setProject(provisioned);

    expect(await insertOrganizeosBlock(signupForm)).toBe(true);

    const [dataProp] = getBlockDataProps();
    expect(dataProp).toEqual(boundToFormsPreset);
    const root = $instances.get().get(dataProp?.instanceId ?? "");
    expect(root?.component).toBe(signupForm);
    expect($instances.get().get("bodyId")?.children).toEqual([
      { type: "id", value: root?.id },
    ]);
    // the preset is used as it is, never rewritten or copied
    expect($resources.get()).toEqual(
      new Map(provisioned.resources.map((resource) => [resource.id, resource]))
    );
    expect($dataSources.get().get(forms.bindingId)).toBe(formsBinding);
    expect(
      [...$dataSources.get().values()].filter(
        (dataSource) => dataSource.type === "resource"
      )
    ).toEqual(provisioned.dataSources);
    expect(toastError).not.toHaveBeenCalled();
  });

  test("creates a missing Forms preset with the deterministic ids and the Events header, and never a second", async () => {
    setProject(withoutForms);

    expect(await insertOrganizeosBlock(signupForm)).toBe(true);

    // scoped at :root and named "OrganizeOS Forms", from the Events base with
    // /forms and the Events Authorization header: exactly what provisioning
    // writes for this project
    expect($resources.get().get(forms.resourceId)).toEqual(scopedFormsResource);
    expect($dataSources.get().get(forms.bindingId)).toEqual(scopedFormsBinding);
    expect(scopedFormsResource.headers).toEqual(eventsResource.headers);
    expect(formsResource).toEqual(scopedFormsResource);
    expect(formsBinding).toEqual(scopedFormsBinding);
    expect(getBlockDataProps()).toEqual([boundToFormsPreset]);

    expect(await insertOrganizeosBlock(signupForm)).toBe(true);

    expect(getBlockDataProps()).toEqual([
      boundToFormsPreset,
      boundToFormsPreset,
    ]);
    expect($resources.get().size).toBe(provisioned.resources.length);
    expect(
      [...$resources.get().values()].filter(
        (resource) => resource.name === "OrganizeOS Forms"
      )
    ).toEqual([scopedFormsResource]);
    expect(
      [...$dataSources.get().values()].filter(
        (dataSource) => dataSource.type === "resource"
      )
    ).toHaveLength(provisioned.dataSources.length);
  });

  test("keeps a Forms preset that appeared while the ids were derived", async () => {
    setProject(withoutForms);
    const inserting = insertOrganizeosBlock(signupForm);
    // e.g. a second click, or a re-provision synced in meanwhile
    const edited = { ...formsResource, name: "Forms (edited)" };
    $resources.set(new Map($resources.get()).set(edited.id, edited));

    expect(await inserting).toBe(true);
    expect($resources.get().get(forms.resourceId)).toBe(edited);
  });

  describe("scopes a Forms preset written with no scope at :root, and changes nothing else", () => {
    test("when the project has it", async () => {
      setProject({
        resources: [...withoutForms.resources, unscopedFormsResource],
        dataSources: [...withoutForms.dataSources, unscopedFormsBinding],
      });

      expect(await insertOrganizeosBlock(signupForm)).toBe(true);

      expect($dataSources.get().get(forms.bindingId)).toEqual({
        ...unscopedFormsBinding,
        scopeInstanceId: ROOT_INSTANCE_ID,
      });
      expect($resources.get().get(forms.resourceId)).toBe(
        unscopedFormsResource
      );
      expect(getBlockDataProps()).toEqual([boundToFormsPreset]);
    });

    // e.g. a re-provision by an older builder, synced in just then
    test.each([
      ["the completion saw no preset", withoutForms],
      ["the completion saw it scoped", provisioned],
    ])(
      "when it appears between the completion and the transaction, and %s",
      async (_case, project) => {
        setProject(project);
        beforeNextTransaction.run = () => {
          $dataSources.set(
            new Map($dataSources.get()).set(
              unscopedFormsBinding.id,
              unscopedFormsBinding
            )
          );
        };

        expect(await insertOrganizeosBlock(signupForm)).toBe(true);

        expect(beforeNextTransaction.run).toBeUndefined();
        expect($dataSources.get().get(forms.bindingId)).toEqual({
          ...unscopedFormsBinding,
          scopeInstanceId: ROOT_INSTANCE_ID,
        });
        expect($resources.get().get(forms.resourceId)).toEqual(
          scopedFormsResource
        );
        expect(getBlockDataProps()).toEqual([boundToFormsPreset]);
      }
    );
  });

  test("inserts at the drop target it is given", async () => {
    setProject(provisioned);
    const data = renderData(
      <$.Body ws:id="bodyId">
        <$.Box ws:id="boxId"></$.Box>
      </$.Body>
    );
    $instances.set(data.instances);

    expect(
      await insertOrganizeosBlock(signupForm, {
        parentSelector: ["bodyId"],
        position: 0,
      })
    ).toBe(true);

    const [dataProp] = getBlockDataProps();
    expect(dataProp).toEqual(boundToFormsPreset);
    expect($instances.get().get("bodyId")?.children).toEqual([
      { type: "id", value: dataProp?.instanceId },
      { type: "id", value: "boxId" },
    ]);
  });

  describe("refuses, writing nothing", () => {
    const withEvents = (headers: Resource["headers"], url?: string) => ({
      ...withoutForms,
      resources: withoutForms.resources.map((resource) =>
        resource.id === events.resourceId
          ? { ...resource, headers, url: url ?? resource.url }
          : resource
      ),
    });

    test.each([
      [
        "the Events preset is missing",
        {
          ...withoutForms,
          resources: withoutForms.resources.filter(
            (resource) => resource.id !== events.resourceId
          ),
        },
      ],
      [
        "the Events preset is missing but Forms is there",
        {
          ...provisioned,
          resources: provisioned.resources.filter(
            (resource) => resource.id !== events.resourceId
          ),
        },
      ],
      ["the Events preset has no headers", withEvents([])],
      [
        "the Events preset has a blank Authorization header",
        withEvents([{ name: "Authorization", value: `""` }]),
      ],
      [
        "the Events preset has another header only",
        withEvents([{ name: "Cache-Control", value: `"max-age=60"` }]),
      ],
      [
        "Forms must be created and the Events URL is not the provisioned one",
        withEvents(eventsResource.headers, `"https://example.org/" + path`),
      ],
    ])("when %s", async (_case, project) => {
      setProject(project);
      const before = getStores();

      expect(await insertOrganizeosBlock(signupForm)).toBe(false);

      const after = getStores();
      for (const [name, store] of Object.entries(before)) {
        expect(after[name as keyof typeof after], name).toBe(store);
      }
      expect(toastError).toHaveBeenCalledTimes(1);
      expect(toastError).toHaveBeenCalledWith(refusal);
    });

    test("when there is no project", async () => {
      setProject(provisioned);
      $project.set(undefined);
      const before = getStores();

      expect(await insertOrganizeosBlock(signupForm)).toBe(false);

      const after = getStores();
      for (const [name, store] of Object.entries(before)) {
        expect(after[name as keyof typeof after], name).toBe(store);
      }
    });
  });

  test.each([
    ["exists", provisioned],
    ["is created", withoutForms],
  ])(
    "binds the preset, not a user variable named Forms, when the preset %s",
    async (_case, project) => {
      setProject({
        resources: project.resources,
        dataSources: [...project.dataSources, globalForms, pageForms],
      });

      expect(await insertOrganizeosBlock(signupForm)).toBe(true);

      expect(getBlockDataProps()).toEqual([boundToFormsPreset]);
      expect($dataSources.get().get(globalForms.id)).toBe(globalForms);
      expect($dataSources.get().get(pageForms.id)).toBe(pageForms);
    }
  );
});

describe("the inserted block's data", () => {
  test("the builder's loader requests the Forms preset, and the block renders its body", async () => {
    setProject(withoutForms);
    expect(await insertOrganizeosBlock(signupForm)).toBe(true);
    loaderFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const requests = JSON.parse(String(init.body)) as ResourceRequest[];
      return {
        ok: true,
        json: async () =>
          requests.map((request) => [getResourceKey(request), formsResult]),
      };
    });

    vi.useFakeTimers();
    const unsubscribe = subscribeResources();
    await vi.advanceTimersByTimeAsync(1000);
    unsubscribe();

    // Forms alone: Events, Fundraisers and Stats are unscoped, so unloaded
    expect(loaderFetch).toHaveBeenCalledTimes(1);
    const [url, init] = loaderFetch.mock.calls[0];
    expect(url).toBe("/rest/resources-loader");
    expect(JSON.parse(init.body)).toEqual([
      {
        name: "OrganizeOS Forms",
        method: "get",
        url: "https://staging.example.org/api/public/v1/forms",
        searchParams: [],
        headers: [{ name: "Authorization", value: "Bearer osk_eventstoken" }],
      },
    ]);
    expect(getBlockDataValues()).toEqual([formsBody]);
    expect(getBlockScopeFormsValues()).toEqual([formsResult]);
  });

  test("keeps the preset's value with a :root variable named Forms listed after it", async () => {
    setProject(withoutForms);
    expect(await insertOrganizeosBlock(signupForm)).toBe(true);
    $dataSources.set(
      new Map($dataSources.get()).set(globalForms.id, globalForms)
    );
    expect([...$dataSources.get().keys()].slice(-1)).toEqual([globalForms.id]);
    const request = computeResourceRequest(
      $resources.get().get(forms.resourceId) as Resource,
      new Map()
    );
    $resourcesCache.set(new Map([[getResourceKey(request), formsResult]]));

    expect(getBlockDataValues()).toEqual([formsBody]);
    expect(getBlockScopeFormsValues()).toEqual([formsResult]);
  });
});

describe("a copy of an inserted block stays bound to the preset, with a page variable named Forms", () => {
  const insertNextToPageForms = async () => {
    setProject({
      resources: provisioned.resources,
      dataSources: [...provisioned.dataSources, pageForms],
    });
    expect(await insertOrganizeosBlock(signupForm)).toBe(true);
  };

  test("when it is duplicated", async () => {
    await insertNextToPageForms();

    emitCommand("duplicateInstance");

    expect(getBlockDataProps()).toEqual([
      boundToFormsPreset,
      boundToFormsPreset,
    ]);
  });

  test("when it is copied and pasted", async () => {
    await insertNextToPageForms();

    const clipboardData = instanceText.onCopy?.() ?? "";
    expect(await instanceText.onPaste?.(clipboardData)).toBe(true);

    expect(getBlockDataProps()).toEqual([
      boundToFormsPreset,
      boundToFormsPreset,
    ]);
  });
});

describe("completeOrganizeosFragment", () => {
  const presets = {
    presetIds: { events, forms },
    resources: new Map(provisioned.resources.map((item) => [item.id, item])),
    dataSources: new Map(
      provisioned.dataSources.map((item) => [item.id, item])
    ),
  };
  const getDataProps = (
    completion: ReturnType<typeof completeOrganizeosFragment>
  ) =>
    completion.status === "ready"
      ? completion.fragment.props.filter((prop) => prop.name === "data")
      : [];

  test("binds a copy, leaving the registered template unbound", () => {
    const template = getComponentTemplateData(signupForm);
    const props = template.props;

    const completion = completeOrganizeosFragment({
      fragment: template,
      ...presets,
    });

    expect(getDataProps(completion)).toEqual([
      { ...boundToFormsPreset, instanceId: template.instances[0].id },
    ]);
    expect(template.props).toBe(props);
    expect(template.props.some((prop) => prop.name === "data")).toBe(false);
  });

  test("adds the Forms preset a project lacks as provisioning builds it, scoped at :root", () => {
    const completion = completeOrganizeosFragment({
      fragment: getComponentTemplateData(signupForm),
      presetIds: { events, forms },
      resources: new Map(withoutForms.resources.map((item) => [item.id, item])),
      dataSources: new Map(
        withoutForms.dataSources.map((item) => [item.id, item])
      ),
    });

    expect(completion).toEqual({
      status: "ready",
      fragment: expect.anything(),
      resources: [scopedFormsResource],
      dataSources: [scopedFormsBinding],
      formsBindingId: forms.bindingId,
    });
    // the records provisioning builds for this project
    expect(scopedFormsResource).toEqual(formsResource);
    expect(scopedFormsBinding).toEqual(formsBinding);
  });

  test("replaces a data prop the template binds by name", () => {
    const template = getComponentTemplateData(signupForm);
    const rootId = template.instances[0].id;
    const byName = {
      ...template,
      props: [
        ...template.props,
        {
          id: "by-name",
          instanceId: rootId,
          name: "data",
          type: "expression" as const,
          value: "Forms.data",
        },
      ],
    };

    const completion = completeOrganizeosFragment({
      fragment: byName,
      ...presets,
    });

    expect(getDataProps(completion)).toEqual([
      { ...boundToFormsPreset, instanceId: rootId },
    ]);
  });

  test("leaves a fragment whose root reads no platform data alone", () => {
    const fragment = getComponentTemplateData("Box");
    expect(
      completeOrganizeosFragment({
        fragment,
        presetIds: { events, forms },
        resources: new Map(),
        dataSources: new Map(),
      })
    ).toEqual({ status: "ready", fragment, resources: [], dataSources: [] });
  });
});
