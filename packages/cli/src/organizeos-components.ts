/**
 * OrganizeOS fork: the OrganizeOS blocks in published sites.
 *
 * The builder renders @organizeos/site-components
 * (packages/sdk-components-organizeos) from its source, but a published site
 * cannot install it: a generated site installs only upstream's npm packages
 * (runtime-version.ts), and this package is never published. So prebuild
 * copies the package's built components module, with the modules it imports,
 * into the site as app source (app/__organizeos__/), and the react-router
 * framework maps every component of the namespace to that copy.
 *
 * The copied modules may import only packages the site template already
 * depends on (react, react-dom, @webstudio-is/react-sdk, @webstudio-is/sdk),
 * which resolve to the site's own pinned copies: nothing to install, link or
 * pin. organizeos-components.test.ts holds the package's build to that.
 */
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import { simple } from "acorn-walk";

/** Every build that uses a block records it, so it never changes. */
export const ORGANIZEOS_NAMESPACE = "@organizeos/site-components";

/** The folder in the site's app/ that holds the copy. */
export const ORGANIZEOS_DIR = "__organizeos__";

/**
 * The copy as the page modules import it. Prebuild writes them to
 * app/__generated__/, so the path is relative to that folder.
 */
export const ORGANIZEOS_COMPONENTS_IMPORT = `../${ORGANIZEOS_DIR}/components.js`;

/** The package's built module behind a source file, as its exports name it. */
const getBuiltModulePath = (sourcePath: string) => {
  let packageDir = dirname(sourcePath);
  while (existsSync(join(packageDir, "package.json")) === false) {
    const parentDir = dirname(packageDir);
    if (parentDir === packageDir) {
      throw new Error(`${sourcePath} is not inside a package`);
    }
    packageDir = parentDir;
  }
  const { exports } = JSON.parse(
    readFileSync(join(packageDir, "package.json"), "utf8")
  );
  const builtPath = exports?.["./components"]?.import;
  if (typeof builtPath !== "string") {
    throw new Error(`${ORGANIZEOS_NAMESPACE} names no build for ./components`);
  }
  return join(packageDir, builtPath);
};

/**
 * The package's built components module, as Node finds it from the CLI's own
 * location (the CLI depends on the package).
 *
 * The built CLI runs under Node's default conditions, which select the build,
 * lib/components.js. Run from source under the "webstudio" condition (as the
 * fixtures' cli script does), Node selects the TypeScript source, and the
 * build is then the module the package's exports name for "import".
 */
export const resolveOrganizeosComponentsModule = (
  resolveSpecifier: (specifier: string) => string = (specifier) =>
    import.meta.resolve(specifier)
) => {
  let modulePath = fileURLToPath(
    resolveSpecifier(`${ORGANIZEOS_NAMESPACE}/components`)
  );
  if (modulePath.endsWith(".js") === false) {
    modulePath = getBuiltModulePath(modulePath);
  }
  if (existsSync(modulePath) === false) {
    throw new Error(
      `${ORGANIZEOS_NAMESPACE} is not built: ${modulePath} is missing. Build it first: pnpm --filter ./packages/sdk-components-organizeos build`
    );
  }
  return modulePath;
};

/** The specifiers an ES module imports, re-exports from, or imports dynamically. */
const getModuleSpecifiers = (code: string, modulePath: string) => {
  const specifiers: string[] = [];
  simple(parse(code, { ecmaVersion: "latest", sourceType: "module" }), {
    ImportDeclaration(node) {
      specifiers.push(String(node.source.value));
    },
    ExportNamedDeclaration(node) {
      if (node.source) {
        specifiers.push(String(node.source.value));
      }
    },
    ExportAllDeclaration(node) {
      specifiers.push(String(node.source.value));
    },
    ImportExpression(node) {
      if (
        node.source.type !== "Literal" ||
        typeof node.source.value !== "string"
      ) {
        throw new Error(`${modulePath} imports a module it does not name`);
      }
      specifiers.push(node.source.value);
    },
  });
  return specifiers;
};

/**
 * A built ES module and every module it reaches through relative specifiers,
 * with the bare specifiers they import. Every module must sit in the entry's
 * folder, the root the copy keeps their paths relative to.
 */
export const findModuleClosure = async (entryPath: string) => {
  const root = dirname(entryPath);
  const modules = new Set<string>();
  const bareSpecifiers = new Set<string>();
  const pending = [entryPath];
  while (pending.length > 0) {
    const modulePath = pending.pop() as string;
    if (modules.has(modulePath)) {
      continue;
    }
    modules.add(modulePath);
    const code = await readFile(modulePath, "utf8");
    for (const specifier of getModuleSpecifiers(code, modulePath)) {
      if (
        specifier.startsWith("./") === false &&
        specifier.startsWith("../") === false
      ) {
        bareSpecifiers.add(specifier);
        continue;
      }
      const importedPath = resolve(dirname(modulePath), specifier);
      const pathFromRoot = relative(root, importedPath);
      if (
        pathFromRoot === ".." ||
        pathFromRoot.startsWith(`..${sep}`) ||
        isAbsolute(pathFromRoot)
      ) {
        throw new Error(`${modulePath} imports ${specifier}, outside ${root}`);
      }
      if (
        importedPath.endsWith(".js") === false ||
        existsSync(importedPath) === false
      ) {
        throw new Error(
          `${modulePath} imports ${specifier}, which is not a built module`
        );
      }
      pending.push(importedPath);
    }
  }
  return {
    modules: Array.from(modules).sort(),
    bareSpecifiers: Array.from(bareSpecifiers).sort(),
  };
};

/**
 * Copy a built components module, and every module it reaches through
 * relative imports, into the site's app/__organizeos__/, keeping their paths.
 * The components module reaches neither metas.js nor templates.js, whose
 * imports (@webstudio-is/template, the icons) a site does not install, so
 * neither is copied.
 */
export const copyOrganizeosComponents = async (
  appDir: string,
  entryPath: string
) => {
  const root = dirname(entryPath);
  const { modules } = await findModuleClosure(entryPath);
  for (const modulePath of modules) {
    const targetPath = join(appDir, ORGANIZEOS_DIR, relative(root, modulePath));
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(modulePath, targetPath);
  }
};
