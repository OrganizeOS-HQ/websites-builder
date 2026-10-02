import { useId } from "react";
import { computed } from "nanostores";
import { useStore } from "@nanostores/react";
import { Flex, Select, Text, theme } from "@webstudio-is/design-system";
import {
  BindingControl,
  BindingPopover,
  validatePrimitiveValue,
} from "~/builder/shared/binding-popover";
import { platformName } from "~/shared/branding";
import {
  $propValuesByInstanceSelector,
  $selectedInstanceKey,
} from "~/shared/nano-states";
import { $instances } from "~/shared/sync/data-stores";
import {
  isOrganizeosBlock,
  organizeosNamespace,
} from "~/builder/features/organizeos-panel/insert-organizeos-block";
import {
  type ControlProps,
  VerticalLayout,
  $selectedInstanceScope,
  updateExpressionValue,
  useBindingState,
  humanizeAttribute,
} from "../shared";
import { PropertyLabel } from "../property-label";

/**
 * The record picker (spec section 3.3): an OrganizeOS block's `record` prop,
 * the id of the platform form the block submits to, is picked from the org's
 * forms instead of typed.
 *
 * The forms come from the block's own computed `data`, which insert binds to
 * the project's Forms preset. The builder already loads every resource bound
 * at the page or at `:root` through its resources loader
 * (`subscribeResources`) and computes the block's props from that cache, so
 * the picker reads the selected block's computed `data` and makes no request
 * of its own.
 */

/**
 * The kinds of form each block's record can name, keyed by the block's full
 * component name, with the label each kind has in the picker. A record prop
 * on a component not listed here keeps the text control.
 */
const acceptedFormKinds: ReadonlyMap<
  string,
  ReadonlyMap<string, string>
> = new Map([
  [
    `${organizeosNamespace}:SignupForm`,
    new Map([
      ["contact-signup", "Newsletter"],
      ["contact-form", "Contact"],
    ]),
  ],
]);

/** Whether a prop gets the record picker instead of its own control. */
export const isOrganizeosRecordProp = (
  component: undefined | string,
  propName: string
) =>
  propName === "record" &&
  component !== undefined &&
  isOrganizeosBlock(component) &&
  acceptedFormKinds.has(component);

export type OrganizeosRecordOption = {
  /** What choosing it writes to `record`: a form id, or "" for the org defaults. */
  value: string;
  label: string;
};

const orgDefaultsOption: OrganizeosRecordOption = {
  value: "",
  label: "None (org defaults)",
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Array.isArray(value) === false;

// The block reads `record` only as a string, and anything else as the org
// defaults.
const toRecordValue = (value: unknown) =>
  typeof value === "string" ? value : "";

/**
 * The options for a block's `record`, from its computed `data`, the
 * `GET /v1/forms` body `{ data: [{ id, kind, name, fields, opt_in }] }`.
 * Read leniently, as the block reads it (`forms-data.ts` in the package), so
 * nothing here throws: `data` of any other shape is no data (unbound, not
 * loaded yet, or the loader's error body), and an entry the block skips, with
 * no string id or no fields, is skipped.
 */
export const getOrganizeosRecordOptions = (
  component: undefined | string,
  data: unknown,
  value: unknown
): {
  options: OrganizeosRecordOption[];
  selected: OrganizeosRecordOption;
  /** Whether `data` is the forms body; the control shows a hint when not. */
  hasData: boolean;
} => {
  const kinds = acceptedFormKinds.get(component ?? "");
  const forms =
    isObject(data) && Array.isArray(data.data) ? data.data : undefined;
  const options = [orgDefaultsOption];
  const ids = new Set<string>();
  for (const form of forms ?? []) {
    if (
      isObject(form) === false ||
      typeof form.id !== "string" ||
      Array.isArray(form.fields) === false ||
      // the block takes the first form with the record's id
      ids.has(form.id)
    ) {
      continue;
    }
    ids.add(form.id);
    const kindLabel =
      typeof form.kind === "string" ? kinds?.get(form.kind) : undefined;
    // The block looks its form up by the trimmed record, so it never finds a
    // blank or padded id.
    if (
      kindLabel === undefined ||
      form.id === "" ||
      form.id !== form.id.trim()
    ) {
      continue;
    }
    const name =
      typeof form.name === "string" && form.name.trim() !== ""
        ? form.name
        : "Untitled form";
    options.push({ value: form.id, label: `${name} (${kindLabel})` });
  }

  const current = toRecordValue(value);
  const currentId = current.trim();
  let selected =
    currentId === ""
      ? orgDefaultsOption
      : options.find((option) => option.value === currentId);
  // The current value is never dropped: a form that was unpublished or
  // deleted, that has not loaded, or that this block does not take stays
  // listed, so the designer sees it and can pick another.
  if (selected === undefined) {
    selected = { value: current, label: "Unavailable form" };
    options.splice(1, 0, selected);
  }
  return { options, selected, hasData: forms !== undefined };
};

/**
 * The selected instance's computed `data`, where its record is picked from.
 * For an inserted block it is the Forms preset's body once the builder's
 * loader has fetched it, and undefined until then.
 */
export const $selectedInstanceDataProp = computed(
  [$propValuesByInstanceSelector, $selectedInstanceKey],
  (propValuesByInstanceSelector, instanceKey) =>
    propValuesByInstanceSelector.get(instanceKey ?? "")?.get("data")
);

// Radix Select refuses an item whose value is the empty string, which is the
// org defaults' value, so every option is keyed with a prefix.
const getOptionKey = (option: OrganizeosRecordOption) =>
  `record:${option.value}`;

const getOptionLabel = (option: OrganizeosRecordOption) => option.label;

const noDataHint = `Your forms load from ${platformName}. If none appear, open the builder again from your Website area in ${platformName}.`;

/**
 * A select with `select.tsx`'s binding support, over the options above, and a
 * hint under it when there is no data.
 */
export const OrganizeosRecordControl = ({
  instanceId,
  meta,
  prop,
  propName,
  computedValue,
  onChange,
}: ControlProps<"text">) => {
  const id = useId();
  const component = useStore($instances).get(instanceId)?.component;
  const data = useStore($selectedInstanceDataProp);
  const { options, selected, hasData } = getOrganizeosRecordOptions(
    component,
    data,
    computedValue
  );

  const label = humanizeAttribute(meta.label || propName);
  const { scope, aliases } = useStore($selectedInstanceScope);
  const expression =
    prop?.type === "expression" ? prop.value : JSON.stringify(computedValue);
  const { overwritable, variant } = useBindingState(
    prop?.type === "expression" ? prop.value : undefined
  );

  return (
    <VerticalLayout
      label={
        <PropertyLabel name={propName} readOnly={overwritable === false} />
      }
    >
      <Flex css={{ gap: theme.spacing[3] }} direction="column">
        <BindingControl>
          <Select
            fullWidth
            id={id}
            disabled={overwritable === false}
            value={selected}
            options={options}
            getLabel={getOptionLabel}
            getValue={getOptionKey}
            // type to find an option by its label, not its key
            getItemProps={(option) => ({ textValue: option.label })}
            onChange={(option) => {
              if (prop?.type === "expression") {
                updateExpressionValue(prop.value, option.value);
              } else {
                onChange({ type: "string", value: option.value });
              }
            }}
          />
          <BindingPopover
            scope={scope}
            aliases={aliases}
            // Checked as the text control checks it, not against the options:
            // a bound id may name a form that has not loaded yet.
            validate={(value) => validatePrimitiveValue(value, label)}
            variant={variant}
            value={expression}
            onChange={(newExpression) =>
              onChange({ type: "expression", value: newExpression })
            }
            onRemove={(evaluatedValue) =>
              onChange({ type: "string", value: toRecordValue(evaluatedValue) })
            }
          />
        </BindingControl>
        {hasData === false && <Text color="subtle">{noDataHint}</Text>}
      </Flex>
    </VerticalLayout>
  );
};
