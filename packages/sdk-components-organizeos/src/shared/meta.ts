const createMetaProxy = (prefix: string): Record<string, string> => {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        return `${prefix}${prop as string}`;
      },
    }
  );
};

/**
 * Namespaced component names for metas, e.g. `organizeos.Field` is
 * "@organizeos/site-components:Field". The namespace is written into every
 * build that uses a block, so it never changes.
 */
export const organizeos = createMetaProxy("@organizeos/site-components:");
