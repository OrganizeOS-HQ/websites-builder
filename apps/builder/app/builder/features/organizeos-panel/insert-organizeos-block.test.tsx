import { beforeEach, describe, expect, test, vi } from "vitest";
import { enableMapSet } from "immer";
import type { Project } from "@webstudio-is/project";
import { createDefaultPages } from "@webstudio-is/project-build";
import { $, renderData } from "@webstudio-is/template";
import * as defaultMetas from "@webstudio-is/sdk-components-react/metas";
import {
  coreMetas,
  encodeDataSourceVariable,
  type DataSource,
  type Resource,
} from "@webstudio-is/sdk";
import * as organizeosMetas from "@organizeos/site-components/metas";
import * as organizeosTemplates from "@organizeos/site-components/templates";
import {
  $registeredComponentMetas,
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
import { getComponentTemplateData } from "~/shared/instance-utils/insert";
import { buildOrgResourcePresets } from "~/shared/db/resource-presets.server";
import {
  completeOrganizeosFragment,
  getOrganizeosPresetIds,
  insertOrganizeosBlock,
} from "./insert-organizeos-block";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("~/shared/builder-api", () => ({
  builderApi: { toast: { error: toastError } },
}));

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
const reconnect =
  "Open the builder again from your Website area in OrganizeOS to reconnect your data.";

// The presets as provisioning writes them for this project (all four), so
// the panel's view of a project is the real one.
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

// A project provisioned before Forms was a preset.
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

const boundToFormsPreset = {
  id: expect.any(String),
  instanceId: expect.any(String),
  name: "data",
  type: "expression",
  value: `${encodeDataSourceVariable(forms.bindingId)}.data`,
};

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

    // exactly what provisioning writes for this project: the Events base with
    // /forms, and the Events Authorization header
    expect($resources.get().get(forms.resourceId)).toEqual(formsResource);
    expect(formsResource.url).toBe(
      `"https://staging.example.org/api/public/v1/forms"`
    );
    expect(formsResource.headers).toEqual(eventsResource.headers);
    expect($dataSources.get().get(forms.bindingId)).toEqual(formsBinding);
    expect(getBlockDataProps()).toEqual([boundToFormsPreset]);

    expect(await insertOrganizeosBlock(signupForm)).toBe(true);

    expect(getBlockDataProps()).toEqual([
      boundToFormsPreset,
      boundToFormsPreset,
    ]);
    expect($resources.get().size).toBe(provisioned.resources.length);
    expect(
      [...$resources.get().values()].filter(
        (resource) => resource.name === "Forms"
      )
    ).toEqual([formsResource]);
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
      expect(toastError).toHaveBeenCalledWith(
        `Cannot add Signup Form: this site is not connected to your organization's data. ${reconnect}`
      );
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
      const globalForms: DataSource = {
        type: "variable",
        id: "user-forms-global",
        scopeInstanceId: ":root",
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
