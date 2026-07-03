import { createHash } from "node:crypto";
import {
  encodeDataVariableId,
  replaceFormActionsWithResources,
  type DataSource,
  type Instance,
  type Pages,
  type Prop,
  type Resource,
  type WebstudioData,
} from "@webstudio-is/sdk";
import {
  parsePages,
  serializePages,
} from "@webstudio-is/project-build/index.server";
import type { AppContext } from "@webstudio-is/trpc-interface/index.server";
import {
  $,
  ws,
  ActionValue,
  expression,
  PlaceholderValue,
  renderData,
  Variable,
} from "@webstudio-is/template";

/**
 * OrganizeOS Websites 2.0: a native signup form preset (Phase 4d write side).
 *
 * Builds a Webstudio form whose submit posts to the OrganizeOS /v1/signups
 * write endpoint. The mechanics:
 *  - The Form has a string `action` prop. replaceFormActionsWithResources turns
 *    it into a server-side ACTION resource (a prop of type 'resource' + a
 *    resource keyed by the form instance id). On submit the runtime posts the
 *    form to the page's server action, which overlays the FormData onto the
 *    resource body and runs it SERVER-SIDE, so the Authorization token never
 *    reaches the browser.
 *  - We inject the org read token into that resource's Authorization header
 *    (referencing the same "Site read token" variable the read presets seed).
 *  - Input `name` attributes become the JSON body keys, so they MUST match the
 *    /v1/signups schema (email, first_name, last_name).
 *  - A `formState` variable drives initial/success/error visibility.
 *
 * This module only ASSEMBLES the form data (pure, testable). Persisting it into
 * a project's build (instance merge + a new page) is a separate step so the
 * data shape can be validated against a running builder before it is wired into
 * provisioning.
 */

// Fixed namespace for signup-form-derived ids. Shares the read-preset token
// variable id (project:v1:token) so both presets reference one token variable.
const PRESET_NAMESPACE = "3f2a1b7c-8d5e-45a1-9b2c-6e0d1a2b3c4d";

const uuidV5 = (name: string): string => {
  const namespaceBytes = Buffer.from(PRESET_NAMESPACE.replace(/-/g, ""), "hex");
  const bytes = createHash("sha1")
    .update(namespaceBytes)
    .update(Buffer.from(name, "utf8"))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

/** Input `name`s, in lockstep with the /v1/signups request schema. */
export const SIGNUP_FORM_FIELD_NAMES = [
  "email",
  "first_name",
  "last_name",
] as const;

/** The signup form subtree wrapped in a page body. */
const signupFormTemplate = (actionUrl: string, bodyId: string) => {
  const formState = new Variable("formState", "initial");
  return (
    <ws.element ws:tag="body" ws:id={bodyId}>
      <$.Form
        action={actionUrl}
        method="post"
        state={expression`${formState}`}
        onStateChange={
          new ActionValue(["state"], expression`${formState} = state`)
        }
      >
        <ws.element
          ws:tag="div"
          ws:label="Form Content"
          ws:show={expression`${formState} === 'initial' || ${formState} === 'error'`}
        >
          <ws.element ws:tag="label">
            {new PlaceholderValue("Email")}
          </ws.element>
          <ws.element
            ws:tag="input"
            name="email"
            type="email"
            required={true}
          />
          <ws.element ws:tag="label">
            {new PlaceholderValue("First name")}
          </ws.element>
          <ws.element ws:tag="input" name="first_name" />
          <ws.element ws:tag="label">
            {new PlaceholderValue("Last name")}
          </ws.element>
          <ws.element ws:tag="input" name="last_name" />
          <ws.element ws:tag="button">
            {new PlaceholderValue("Sign up")}
          </ws.element>
        </ws.element>
        <ws.element
          ws:tag="div"
          ws:label="Success"
          ws:show={expression`${formState} === 'success'`}
        >
          {new PlaceholderValue("Thanks for signing up!")}
        </ws.element>
        <ws.element
          ws:tag="div"
          ws:label="Error"
          ws:show={expression`${formState} === 'error'`}
        >
          {new PlaceholderValue("Something went wrong. Please try again.")}
        </ws.element>
      </$.Form>
    </ws.element>
  );
};

export type SignupFormData = {
  /** The rendered + resource-wired form data (instances/props/dataSources/resources/...). */
  data: Omit<WebstudioData, "pages">;
  /** Body instance id: the rootInstanceId for the seeded signup page. */
  bodyId: string;
  /** Deterministic id for the seeded "Sign up" page. */
  pageId: string;
};

/**
 * Assemble the signup form: render the template with deterministic ids, convert
 * the form action into a server-side action resource, inject the org token
 * header, and attach the shared token variable. Pure: no I/O. Deterministic per
 * projectId, so re-seeding converges instead of duplicating.
 */
export const buildSignupFormData = ({
  projectId,
  apiBaseUrl,
  readToken,
}: {
  projectId: string;
  apiBaseUrl: string;
  readToken: string;
}): SignupFormData => {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const bodyId = uuidV5(`${projectId}:signup:body`);
  const tokenVariableId = uuidV5(`${projectId}:v1:token`);

  let counter = 0;
  const generateId = () => uuidV5(`${projectId}:signup:${counter++}`);

  const data = renderData(
    signupFormTemplate(`${base}/signups`, bodyId),
    generateId
  );

  // Turn the form's string action into a server-side action resource.
  replaceFormActionsWithResources({
    props: data.props,
    instances: data.instances,
    resources: data.resources,
  });

  // Inject the org read token into the action resource's Authorization header,
  // referencing the shared "Site read token" variable (encodeDataVariableId
  // handles the id -> expression encoding, dashes -> __DASH__).
  const authHeaderValue = `"Bearer " + ${encodeDataVariableId(tokenVariableId)}`;
  for (const resource of data.resources.values()) {
    if (resource.name === "action") {
      resource.headers.push({ name: "Authorization", value: authHeaderValue });
    }
  }

  // The token variable the header references. Same id as the read presets seed,
  // so the two presets share one variable (deduped on merge).
  data.dataSources.set(tokenVariableId, {
    type: "variable",
    id: tokenVariableId,
    name: "Site read token",
    value: { type: "string", value: readToken },
  });

  return { data, bodyId, pageId: uuidV5(`${projectId}:signup:page`) };
};

/** Replace entries sharing an incoming id, keep the rest, append the incoming. */
const mergeById = <Type extends { id: string }>(
  existing: Type[],
  incoming: Type[]
): Type[] => {
  const incomingIds = new Set(incoming.map((item) => item.id));
  return [...existing.filter((item) => !incomingIds.has(item.id)), ...incoming];
};

export type BuildContent = {
  instances: Instance[];
  props: Prop[];
  dataSources: DataSource[];
  resources: Resource[];
  pages: Pages;
};

/**
 * Merge the signup form into a build's content and add a "Sign up" page. Pure:
 * mutates only the returned values (pages is mutated in place, so pass a build
 * you own). Only the content maps are merged: the form's PRESET STYLES and
 * breakpoints are intentionally dropped so the seeded fragment never has to
 * reconcile its breakpoints against the build's. The starter form ships
 * unstyled; the org styles it in the builder. Deterministic ids make this
 * idempotent (re-seed replaces in place).
 */
export const mergeSignupFormIntoBuild = (
  build: BuildContent,
  {
    projectId,
    apiBaseUrl,
    readToken,
  }: { projectId: string; apiBaseUrl: string; readToken: string }
): BuildContent => {
  const { data, bodyId, pageId } = buildSignupFormData({
    projectId,
    apiBaseUrl,
    readToken,
  });

  const instances = mergeById(build.instances, [...data.instances.values()]);
  const props = mergeById(build.props, [...data.props.values()]);
  const dataSources = mergeById(build.dataSources, [
    ...data.dataSources.values(),
  ]);
  const resources = mergeById(build.resources, [...data.resources.values()]);

  const pages = build.pages;
  pages.pages.set(pageId, {
    id: pageId,
    name: "Sign up",
    path: "/signup",
    // title is an expression (a quoted string literal), matching createPages.
    title: `"Sign up"`,
    meta: {},
    rootInstanceId: bodyId,
  });
  const rootFolder = pages.folders.get(pages.rootFolderId);
  if (rootFolder && rootFolder.children.includes(pageId) === false) {
    rootFolder.children.push(pageId);
  }

  return { instances, props, dataSources, resources, pages };
};

/**
 * Seed (or re-sync) the org's dev build with the signup form + a "Sign up"
 * page. Loads the dev build (deployment is null), merges content-only, writes
 * back. Idempotent. Runs alongside seedProjectResourcePresets at provision time.
 */
export const seedSignupFormPage = async (
  context: AppContext,
  {
    projectId,
    apiBaseUrl,
    readToken,
  }: { projectId: string; apiBaseUrl: string; readToken: string }
): Promise<void> => {
  const client = context.postgrest.client;

  const build = await client
    .from("Build")
    .select("id, instances, props, dataSources, resources, pages")
    .eq("projectId", projectId)
    .is("deployment", null)
    .single();
  if (build.error) {
    throw build.error;
  }

  const merged = mergeSignupFormIntoBuild(
    {
      instances: JSON.parse(build.data.instances ?? "[]") as Instance[],
      props: JSON.parse(build.data.props ?? "[]") as Prop[],
      dataSources: JSON.parse(build.data.dataSources ?? "[]") as DataSource[],
      resources: JSON.parse(build.data.resources ?? "[]") as Resource[],
      pages: parsePages(build.data.pages),
    },
    { projectId, apiBaseUrl, readToken }
  );

  const update = await client
    .from("Build")
    .update({
      instances: JSON.stringify(merged.instances),
      props: JSON.stringify(merged.props),
      dataSources: JSON.stringify(merged.dataSources),
      resources: JSON.stringify(merged.resources),
      pages: serializePages(merged.pages),
    })
    .eq("id", build.data.id);
  if (update.error) {
    throw update.error;
  }
};
