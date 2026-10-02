import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** A form field as the platform describes it (`GET /v1/forms`, `fields[]`). */
export type FormFieldConfig = {
  name: string;
  label: string;
  /** text, email, phone, textarea, select or checkbox; anything else renders as text. */
  type: string;
  required: boolean;
  options: readonly string[] | null;
};

/**
 * A part announces itself to its root, so the root knows which fields it
 * collects and, on the canvas, which parts it lacks.
 */
export type FormPart = {
  kind: "field" | "input" | "submit";
  /** The form field a Field or a Field Input stands for. */
  name?: string;
  /** Reads a Field Input's current value the way the platform expects it. */
  read?: () => string;
};

/** What a root shares with its parts. */
export type FormRoot = {
  register: (part: FormPart) => () => void;
  /** The fields of the root's record, undefined while the record is unknown. */
  fields: readonly FormFieldConfig[] | undefined;
  /** A generic message per field name, from an `invalid_field` answer. */
  fieldErrors: ReadonlyMap<string, string>;
  /** The root's current state, in the family's own state names. */
  state: string;
};

export const FormRootContext = createContext<FormRoot | undefined>(undefined);

/**
 * The root's side of registration. Parts register in a layout effect, so the
 * root renders again with every part known before the browser paints: the
 * canvas check never flashes a warning for a part that is about to register.
 */
export const usePartRegistry = () => {
  const [registry, setRegistry] = useState<ReadonlyMap<number, FormPart>>(
    () => new Map()
  );
  const lastKey = useRef(0);
  const register = useCallback((part: FormPart) => {
    lastKey.current += 1;
    const key = lastKey.current;
    setRegistry((previous) => new Map(previous).set(key, part));
    return () => {
      setRegistry((previous) => {
        const next = new Map(previous);
        next.delete(key);
        return next;
      });
    };
  }, []);
  const parts = useMemo(() => Array.from(registry.values()), [registry]);
  return { parts, register };
};

/** The part's side: register with the closest root, if there is one. */
export const useRegisterPart = (part: FormPart | undefined) => {
  const register = useContext(FormRootContext)?.register;
  const kind = part?.kind;
  const name = part?.name;
  const read = part?.read;
  useLayoutEffect(() => {
    if (register === undefined || kind === undefined) {
      return;
    }
    return register({ kind, name, read });
  }, [register, kind, name, read]);
};
