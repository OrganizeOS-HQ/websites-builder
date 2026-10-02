import { nanoid } from "nanoid";
import {
  type DataSource,
  type DataSources,
  type Prop,
  type Resource,
  type Resources,
  type WebstudioFragment,
  encodeDataSourceVariable,
} from "@webstudio-is/sdk";
import { builderApi } from "~/shared/builder-api";
import { platformName } from "~/shared/branding";
import { getResourcePresetIds } from "~/shared/organizeos-preset-ids";
import { $dataSources, $project, $resources } from "~/shared/sync/data-stores";
import { updateWebstudioData } from "~/shared/instance-utils/data";
import {
  type Insertable,
  findClosestInsertable,
  getComponentTemplateData,
  insertWebstudioFragmentAt,
} from "~/shared/instance-utils/insert";
import { getInstanceLabel } from "~/builder/shared/instance-label";

/**
 * Inserting an OrganizeOS block (spec section 4.3). A template cannot know a
 * project's preset ids, so the block's fragment is completed at insert time:
 * the root's `data` prop is bound, by id, to the project's Forms preset, and
 * the preset is added when the project lacks it, from the Events preset that
 * provisioning wrote. Click (the OrganizeOS panel) and drop (the canvas's
 * drag and drop) both insert through here.
 */

/** The namespace the blocks are registered under (canvas.tsx). */
export const organizeosNamespace = "@organizeos/site-components";

export const isOrganizeosBlock = (component: string) =>
  component.startsWith(`${organizeosNamespace}:`);

// Blocks whose root reads the org's published forms through its `data` prop.
const formsBlocks = new Set([`${organizeosNamespace}:SignupForm`]);

// Provisioning names each preset after its endpoint (resource-presets.server.ts).
const formsPresetLabel = "Forms";

type PresetIds = { resourceId: string; bindingId: string };

export type OrganizeosPresetIds = { events: PresetIds; forms: PresetIds };

export const getOrganizeosPresetIds = async (
  projectId: string
): Promise<OrganizeosPresetIds> => {
  const [events, forms] = await Promise.all([
    getResourcePresetIds(projectId, "events"),
    getResourcePresetIds(projectId, "forms"),
  ]);
  return { events, forms };
};

const isBlankExpression = (expression: string) => {
  try {
    const value: unknown = JSON.parse(expression);
    return typeof value === "string" && value.trim() === "";
  } catch {
    return expression.trim() === "";
  }
};

const findAuthorizationHeader = (resource: Resource) =>
  resource.headers.find(
    (header) =>
      header.name.toLowerCase() === "authorization" &&
      isBlankExpression(header.value) === false
  );

/**
 * The Forms endpoint next to the Events one. Provisioning writes the Events
 * URL as a string literal, `"<API base>/events"`; anything else is not a URL
 * this can derive from.
 */
const getFormsUrl = (eventsUrl: string) => {
  let url: unknown;
  try {
    url = JSON.parse(eventsUrl);
  } catch {
    return;
  }
  if (typeof url !== "string" || url.endsWith("/events") === false) {
    return;
  }
  return JSON.stringify(`${url.slice(0, -"/events".length)}/forms`);
};

export type OrganizeosBlockCompletion =
  | { status: "refused" }
  | {
      status: "ready";
      fragment: WebstudioFragment;
      // What the project lacks of the Forms preset, to write before inserting.
      resources: Resource[];
      dataSources: DataSource[];
    };

/**
 * Complete a block's template fragment against the project's presets. Pure:
 * reads the given maps, returns the fragment to insert and the preset records
 * to add, never touches a store.
 */
export const completeOrganizeosFragment = ({
  fragment,
  presetIds,
  resources,
  dataSources,
}: {
  fragment: WebstudioFragment;
  presetIds: OrganizeosPresetIds;
  resources: Resources;
  dataSources: DataSources;
}): OrganizeosBlockCompletion => {
  const rootChild = fragment.children.find((child) => child.type === "id");
  const root = fragment.instances.find(
    (instance) => instance.id === rootChild?.value
  );
  if (root === undefined || formsBlocks.has(root.component) === false) {
    return { status: "ready", fragment, resources: [], dataSources: [] };
  }

  // The Events preset, found by its id and never by name, is the project's
  // link to the org's data: its API base and its read token. Without it, or
  // without the token, a Forms preset could not authenticate, so nothing is
  // written and the admin is told how to reconnect.
  const events = resources.get(presetIds.events.resourceId);
  const authorization =
    events === undefined ? undefined : findAuthorizationHeader(events);
  if (events === undefined || authorization === undefined) {
    return { status: "refused" };
  }

  // Find or create the Forms preset by the ids provisioning gives it, in the
  // shape provisioning writes (buildOrgResourcePresets), so a re-provision
  // rewrites this same preset instead of adding a second one.
  const { forms } = presetIds;
  const newResources: Resource[] = [];
  const newDataSources: DataSource[] = [];
  const binding = dataSources.get(forms.bindingId);
  if (binding === undefined) {
    newDataSources.push({
      type: "resource",
      id: forms.bindingId,
      name: formsPresetLabel,
      resourceId: forms.resourceId,
    });
  }
  const bindsFormsResource =
    binding === undefined ||
    (binding.type === "resource" && binding.resourceId === forms.resourceId);
  if (resources.has(forms.resourceId) === false && bindsFormsResource) {
    const url = getFormsUrl(events.url);
    if (url === undefined) {
      return { status: "refused" };
    }
    newResources.push({
      id: forms.resourceId,
      name: formsPresetLabel,
      method: "get",
      url,
      headers: [{ name: "Authorization", value: authorization.value }],
    });
  }

  // Bind the root's `data` to the preset's variable by id. Inserting resolves
  // a fragment's names against the variables in scope where it lands, so a
  // name would bind to whatever variable an admin happened to call "Forms".
  // `.data` is the response body, `{ data: [...] }` from GET /v1/forms, not
  // the whole resource result `{ ok, status, statusText, data }`.
  const dataProp: Prop = {
    id: nanoid(),
    instanceId: root.id,
    name: "data",
    type: "expression",
    value: `${encodeDataSourceVariable(forms.bindingId)}.data`,
  };
  return {
    status: "ready",
    fragment: {
      ...fragment,
      props: [
        ...fragment.props.filter(
          (prop) => prop.instanceId !== root.id || prop.name !== "data"
        ),
        dataProp,
      ],
    },
    resources: newResources,
    dataSources: newDataSources,
  };
};

/**
 * Insert a block at the selection, or at `insertable` (a drop), the way the
 * Components panel inserts a template, after completing it. Refuses with a
 * toast, writing nothing, when the project's data is not connected.
 */
export const insertOrganizeosBlock = async (
  component: string,
  insertable?: Insertable
): Promise<boolean> => {
  const project = $project.get();
  if (project === undefined) {
    return false;
  }
  const label = getInstanceLabel({ component });
  let presetIds: OrganizeosPresetIds;
  try {
    presetIds = await getOrganizeosPresetIds(project.id);
  } catch (error) {
    console.error(error);
    builderApi.toast.error(`Cannot add ${label}.`);
    return false;
  }

  const completion = completeOrganizeosFragment({
    fragment: getComponentTemplateData(component),
    presetIds,
    resources: $resources.get(),
    dataSources: $dataSources.get(),
  });
  if (completion.status === "refused") {
    builderApi.toast.error(
      `Cannot add ${label}: this site is not connected to your organization's data. Open the builder again from your Website area in ${platformName} to reconnect your data.`
    );
    return false;
  }

  // Resolve the target first, as insertWebstudioFragmentAt does, so a block
  // with no place here adds no preset either.
  const target =
    findClosestInsertable(completion.fragment, insertable) ?? insertable;
  if (target === undefined) {
    return false;
  }
  if (completion.resources.length > 0 || completion.dataSources.length > 0) {
    // Through the same transactions as any edit, so it syncs and undoes like
    // one; its own, because the insert below opens another. Records that
    // appeared meanwhile are kept: the ids are the preset's, never a copy.
    updateWebstudioData((data) => {
      for (const resource of completion.resources) {
        if (data.resources.has(resource.id) === false) {
          data.resources.set(resource.id, resource);
        }
      }
      for (const dataSource of completion.dataSources) {
        if (data.dataSources.has(dataSource.id) === false) {
          data.dataSources.set(dataSource.id, dataSource);
        }
      }
    });
  }
  return insertWebstudioFragmentAt(completion.fragment, target);
};
