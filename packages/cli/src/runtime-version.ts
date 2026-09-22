/**
 * The upstream Webstudio release whose npm packages a published site installs.
 *
 * OrganizeOS fork. Upstream stamps every workspace package and every CLI
 * template with a real version at publish time; the monorepo placeholder
 * `0.0.0-webstudio-version` never reaches npm. This fork publishes nothing, so
 * a generated site's package.json carried the placeholder verbatim, and the
 * first publish that ever reached Vercel died in `npm install` with ETARGET.
 *
 * Sites consume UPSTREAM's public packages on purpose rather than this fork's
 * (ORGANIZEOS-FORK.md §1): the runtime packages are byte-identical to upstream
 * (no fork commit has ever touched them), so §13 only ever covers source that
 * is already public. That makes this constant the one number tying the code
 * the CLI generates to the packages it imports from.
 *
 * It must be the upstream release matching the fork's upstream base: the first
 * release AFTER the base commit, at its latest patch (base 2026-06-24 -> the
 * 0.274 line -> 0.274.5). Bump it in the same change as any upstream merge. A
 * stale value does not fail here; it fails on the next publish, in Vercel's
 * build log, after the site has already been built and uploaded.
 */
export const PUBLISHED_RUNTIME_VERSION = "0.274.5";

export const VERSION_PLACEHOLDER = "0.0.0-webstudio-version";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/**
 * Return a copy of a package.json object with the placeholder replaced by the
 * published runtime version in every dependency map. Pure.
 *
 * Throws if the placeholder survives anywhere else in the document: an
 * upstream change that puts it somewhere new must fail the build here, where
 * the message names the file, not on Vercel after the upload.
 */
export const pinRuntimeDependencies = (
  packageJson: Record<string, unknown>,
  version: string = PUBLISHED_RUNTIME_VERSION
): Record<string, unknown> => {
  const result: Record<string, unknown> = { ...packageJson };
  for (const field of DEPENDENCY_FIELDS) {
    const deps = result[field];
    if (typeof deps !== "object" || deps === null) {
      continue;
    }
    result[field] = Object.fromEntries(
      Object.entries(deps as Record<string, unknown>).map(([name, range]) => [
        name,
        range === VERSION_PLACEHOLDER ? version : range,
      ])
    );
  }
  if (JSON.stringify(result).includes(VERSION_PLACEHOLDER)) {
    throw new Error(
      `"${VERSION_PLACEHOLDER}" survives in package.json outside a dependency map; pin it to ${version}`
    );
  }
  return result;
};
