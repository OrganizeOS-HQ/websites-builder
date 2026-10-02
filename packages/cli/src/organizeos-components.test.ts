import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as organizeosComponentMetas from "@organizeos/site-components/metas";
import { createFramework } from "./framework-react-router";
import {
  ORGANIZEOS_NAMESPACE,
  copyOrganizeosComponents,
  findModuleClosure,
  resolveOrganizeosComponentsModule,
} from "./organizeos-components";

const originalCwd = process.cwd();
let tempDir: string;

const cliDir = fileURLToPath(new URL("..", import.meta.url));
const packageDir = fileURLToPath(
  new URL("../../sdk-components-organizeos", import.meta.url)
);
const specifier = `${ORGANIZEOS_NAMESPACE}/components`;

// The build the copy comes from. The CLI tests need it: build the package
// first (pnpm --filter ./packages/sdk-components-organizeos build).
const getBuiltModule = () =>
  realpathSync(join(packageDir, "lib", "components.js"));

/**
 * Node's own resolver, run from the CLI's folder as the built CLI
 * (lib/cli.js) runs it. Vitest's module runner has no import.meta.resolve.
 */
const resolveWithNode =
  (conditions: string[] = []) =>
  (specifier: string) => {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    return execFileSync(
      process.execPath,
      [
        ...conditions.map((condition) => `--conditions=${condition}`),
        "--input-type=module",
        "--eval",
        `process.stdout.write(import.meta.resolve(${JSON.stringify(specifier)}))`,
      ],
      { cwd: cliDir, env, encoding: "utf8" }
    );
  };

/** A subpath import counts as its package: react/jsx-runtime is react. */
const getPackageName = (specifier: string) =>
  specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");

const writeModules = async (dir: string, modules: Record<string, string>) => {
  for (const [path, code] of Object.entries(modules)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), code, "utf8");
  }
};

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "webstudio-organizeos-"));
  process.chdir(tempDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

describe("resolveOrganizeosComponentsModule", () => {
  test("the built CLI finds the package's build", () => {
    const resolve = resolveWithNode();
    expect(fileURLToPath(resolve(specifier))).toBe(getBuiltModule());
    expect(resolveOrganizeosComponentsModule(resolve)).toBe(getBuiltModule());
  });

  test("run from source under the webstudio condition, it still finds the build", () => {
    const resolve = resolveWithNode(["webstudio"]);
    expect(fileURLToPath(resolve(specifier))).toBe(
      join(packageDir, "src", "components.ts")
    );
    expect(resolveOrganizeosComponentsModule(resolve)).toBe(getBuiltModule());
  });

  test("a missing build fails with the command that makes it", () => {
    const missing = pathToFileURL(join(tempDir, "lib", "components.js")).href;
    expect(() => resolveOrganizeosComponentsModule(() => missing)).toThrow(
      /is not built: .* Build it first: pnpm --filter \.\/packages\/sdk-components-organizeos build/
    );
  });
});

describe("the react-router framework", () => {
  test("maps every component of the package's metas to the copy, by its path from app/__generated__/", async () => {
    await cp(
      join(cliDir, "templates", "react-router", "app", "route-templates"),
      join("app", "route-templates"),
      { recursive: true }
    );
    const framework = await createFramework();

    const names = Object.keys(organizeosComponentMetas);
    expect(names).toContain("SignupForm");
    for (const [name, meta] of Object.entries(organizeosComponentMetas)) {
      const component = `@organizeos/site-components:${name}`;
      expect(framework.components[component]).toBe(
        `../__organizeos__/components.js:${name}`
      );
      expect(framework.metas[component]).toBe(meta);
    }
  });

  test("every component it maps is exported by the build the copy is made of", async () => {
    const copy = await import(pathToFileURL(getBuiltModule()).href);
    expect(Object.keys(copy)).toEqual(
      expect.arrayContaining(Object.keys(organizeosComponentMetas))
    );
  });
});

describe("the copy of the build", () => {
  test("never reaches metas.js, templates.js or the modules they import", async () => {
    const libDir = dirname(getBuiltModule());
    // Both are in the build, so not reaching them is not an accident.
    expect(existsSync(join(libDir, "metas.js"))).toBe(true);
    expect(existsSync(join(libDir, "templates.js"))).toBe(true);

    const { modules } = await findModuleClosure(getBuiltModule());
    const paths = modules.map((path) => relative(libDir, path));
    expect(paths).toContain("components.js");
    expect(paths).toContain(join("signup", "signup-form.js"));
    expect(paths).not.toContain("metas.js");
    expect(paths).not.toContain("templates.js");
    expect(paths.filter((path) => /\.(ws|template)\.js$/.test(path))).toEqual(
      []
    );
  });

  test("imports only packages the react-router site template depends on", async () => {
    const { bareSpecifiers } = await findModuleClosure(getBuiltModule());
    const template = JSON.parse(
      await readFile(
        join(cliDir, "templates", "react-router", "package.json"),
        "utf8"
      )
    );

    expect(bareSpecifiers).toContain("react");
    for (const bareSpecifier of bareSpecifiers) {
      expect(Object.keys(template.dependencies), bareSpecifier).toContain(
        getPackageName(bareSpecifier)
      );
    }
  });
});

describe("findModuleClosure", () => {
  test("follows imports, re-exports and literal dynamic imports, and the copy holds exactly what it reaches", async () => {
    const libDir = join(tempDir, "lib");
    await writeModules(libDir, {
      "components.js": [
        `import { a } from "./parts/a.js";`,
        `import { jsx } from "react/jsx-runtime";`,
        `export { b } from "./parts/b.js";`,
        `export * from "./parts/c.js";`,
        `export const load = () => import("./lazy.js");`,
        `export { a, jsx };`,
      ].join("\n"),
      "parts/a.js": `import { shared } from "../shared.js";\nexport const a = shared;`,
      "parts/b.js": `export const b = 1;`,
      "parts/c.js": `import { useContext } from "react";\nimport "@webstudio-is/react-sdk/runtime";\nexport const c = useContext;`,
      "lazy.js": `export default 1;`,
      "shared.js": `export const shared = 1;`,
      "metas.js": `import { EmailIcon } from "@webstudio-is/icons/svg";\nexport const meta = EmailIcon;`,
    });

    const entryPath = join(libDir, "components.js");
    const { modules, bareSpecifiers } = await findModuleClosure(entryPath);
    const reached = [
      "components.js",
      "lazy.js",
      join("parts", "a.js"),
      join("parts", "b.js"),
      join("parts", "c.js"),
      "shared.js",
    ];
    expect(modules.map((path) => relative(libDir, path)).sort()).toEqual(
      reached.sort()
    );
    expect(bareSpecifiers).toEqual([
      "@webstudio-is/react-sdk/runtime",
      "react",
      "react/jsx-runtime",
    ]);

    await copyOrganizeosComponents("app", entryPath);
    for (const path of reached) {
      await expect(
        readFile(join("app", "__organizeos__", path), "utf8")
      ).resolves.toEqual(await readFile(join(libDir, path), "utf8"));
    }
    expect(existsSync(join("app", "__organizeos__", "metas.js"))).toBe(false);
  });

  test("refuses what it could not copy as it is", async () => {
    const libDir = join(tempDir, "lib");
    await writeModules(tempDir, { "outside.js": `export const x = 1;` });
    await writeModules(libDir, {
      "escapes.js": `import { x } from "../outside.js";\nexport { x };`,
      "computed.js": `const name = "lazy";\nexport const load = () => import(\`./\${name}.js\`);`,
      "missing.js": `export { x } from "./nowhere.js";`,
      "style.js": `import "./style.css";`,
      "style.css": `form { margin: 0; }`,
    });

    await expect(findModuleClosure(join(libDir, "escapes.js"))).rejects.toThrow(
      /imports \.\.\/outside\.js, outside/
    );
    await expect(
      findModuleClosure(join(libDir, "computed.js"))
    ).rejects.toThrow(/imports a module it does not name/);
    await expect(findModuleClosure(join(libDir, "missing.js"))).rejects.toThrow(
      /imports \.\/nowhere\.js, which is not a built module/
    );
    await expect(findModuleClosure(join(libDir, "style.js"))).rejects.toThrow(
      /imports \.\/style\.css, which is not a built module/
    );
  });
});
