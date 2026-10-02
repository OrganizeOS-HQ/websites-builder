import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { bundleVersion } from "@webstudio-is/protocol";
import { encodeDataSourceVariable } from "@webstudio-is/sdk";
import { generateRedirectsModule, prebuild } from "./prebuild";
import {
  findModuleClosure,
  resolveOrganizeosComponentsModule,
} from "./organizeos-components";

// OrganizeOS fork: Vitest's module runner has no import.meta.resolve, and it
// resolves @organizeos/site-components with the webstudio condition, to the
// package's source. Hand the CLI that source: it finds the package's build
// from there, as it does when it runs from source (organizeos-components.ts).
vi.mock("./organizeos-components", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./organizeos-components")>();
  return {
    ...actual,
    resolveOrganizeosComponentsModule: () =>
      actual.resolveOrganizeosComponentsModule(
        () =>
          new URL(
            "../../sdk-components-organizeos/src/components.ts",
            import.meta.url
          ).href
      ),
  };
});

const originalCwd = process.cwd();
const originalFetch = globalThis.fetch;
let tempDir: string;
let consoleInfo: ReturnType<typeof vi.spyOn>;
const rootFolderId = "root";
const elementComponent = "ws:element";
const slowPrebuildTestTimeout = 15_000;
type Redirects = Array<{ old: string; new: string; status?: "301" | "302" }>;

const getFilePaths = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return getFilePaths(path);
      }
      return [path];
    })
  );
  return paths.flat();
};

const createSiteData = (
  overrides: {
    pages?: Array<{
      id: string;
      name: string;
      title: string;
      path: string;
      rootInstanceId: string;
      meta: Record<string, unknown>;
    }>;
    instances?: Array<
      [
        string,
        {
          type?: "instance";
          id: string;
          component: string;
          tag?: string;
          children: Array<{ type: "id"; value: string }>;
        },
      ]
    >;
    pageMeta?: Record<string, unknown>;
    redirects?: Redirects;
    // OrganizeOS fork: the Forms preset cases below set these three.
    props?: Array<[string, Record<string, unknown>]>;
    dataSources?: Array<[string, Record<string, unknown>]>;
    resources?: Array<[string, Record<string, unknown>]>;
  } = {}
) => {
  const pages = overrides.pages ?? [
    {
      id: "home",
      name: "Home",
      title: "Home",
      path: "",
      rootInstanceId: "root",
      meta: {},
    },
  ];

  return {
    bundleVersion,
    origin: "https://assets.example",
    projectDomain: "example.com",
    projectTitle: "Example",
    user: {
      email: "owner@example.com",
    },
    page: pages[0],
    pages,
    assets: [
      {
        id: "asset-image",
        projectId: "project-id",
        name: "image.png",
        type: "image",
        format: "png",
        size: 1,
        meta: {
          width: 1,
          height: 1,
        },
        description: "",
        createdAt: "2024-01-01T00:00:00.000Z",
      },
    ],
    build: {
      id: "build-id",
      projectId: "project-id",
      version: 1,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      pages: {
        meta: {
          siteName: "Site",
          contactEmail: "",
          ...overrides.pageMeta,
        },
        compiler: {
          atomicStyles: true,
        },
        redirects: overrides.redirects ?? [
          {
            old: "/dl.php?filename=file.pdf",
            new: "/downloads/file.pdf",
          },
          {
            old: "/über",
            new: "/ueber",
            status: "302",
          },
        ],
        homePageId: pages[0].id,
        rootFolderId,
        pages,
        folders: [
          {
            id: rootFolderId,
            name: "Root",
            slug: "",
            children: pages.map((page) => page.id),
          },
        ],
      },
      props: overrides.props ?? [],
      instances: (
        overrides.instances ?? [
          [
            "root",
            {
              id: "root",
              component: "Box",
              children: [],
            },
          ],
        ]
      ).map(([id, instance]) => [id, { type: "instance", ...instance }]),
      dataSources: overrides.dataSources ?? [],
      resources: overrides.resources ?? [],
      styleSources: [],
      styleSourceSelections: [],
      styles: [],
      breakpoints: [],
    },
  };
};

const writeSiteData = async (
  siteData: ReturnType<typeof createSiteData> = createSiteData()
) => {
  await writeFile(".webstudio/data.json", JSON.stringify(siteData), "utf8");
};

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "webstudio-prebuild-"));
  process.chdir(tempDir);
  consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
  await mkdir(".webstudio", { recursive: true });
  await writeSiteData();
});

afterEach(async () => {
  consoleInfo.mockRestore();
  process.chdir(originalCwd);
  globalThis.fetch = originalFetch;
  await rm(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("generateRedirectsModule", () => {
  test("generates an empty redirects data module", () => {
    expect(generateRedirectsModule(undefined)).toEqual(`
    export const redirects = [];
    `);
  });

  test("preserves redirect sources exactly as data", () => {
    const redirects = [
      {
        old: "/dl.php?filename=file.pdf",
        new: "/downloads/file.pdf",
      },
      {
        old: "/path?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3Dc",
        new: "/target",
        status: "302",
      },
      {
        old: "/über",
        new: "/ueber",
      },
      {
        old: "/%E6%B8%AF%E8%81%9E",
        new: "/news",
      },
      {
        old: "/path%20with%20spaces",
        new: "/spaces",
      },
      {
        old: "/old#section",
        new: "/new#target",
      },
    ] satisfies Redirects;

    expect(generateRedirectsModule(redirects)).toEqual(`
    export const redirects = [
  {
    "old": "/dl.php?filename=file.pdf",
    "new": "/downloads/file.pdf",
    "status": 301
  },
  {
    "old": "/path?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3Dc",
    "new": "/target",
    "status": "302"
  },
  {
    "old": "/über",
    "new": "/ueber",
    "status": 301
  },
  {
    "old": "/%E6%B8%AF%E8%81%9E",
    "new": "/news",
    "status": 301
  },
  {
    "old": "/path%20with%20spaces",
    "new": "/spaces",
    "status": 301
  },
  {
    "old": "/old#section",
    "new": "/new#target",
    "status": 301
  }
];
    `);
  });
});

describe("prebuild", () => {
  test("scaffolds generated files and stores redirects as data", async () => {
    await mkdir("app/__generated__", { recursive: true });
    await mkdir("app/routes", { recursive: true });
    await writeFile("app/__generated__/stale.ts", "stale", "utf8");
    await writeFile("app/routes/stale.tsx", "stale", "utf8");

    await prebuild({
      assets: false,
      template: ["defaults"],
    });

    const redirectsModule = await readFile(
      "app/__generated__/$resources.redirects.ts",
      "utf8"
    );
    expect(redirectsModule).toEqual(
      generateRedirectsModule([
        {
          old: "/dl.php?filename=file.pdf",
          new: "/downloads/file.pdf",
        },
        {
          old: "/über",
          new: "/ueber",
          status: "302",
        },
      ])
    );

    await expect(
      readFile("app/__generated__/$resources.assets.ts", "utf8")
    ).resolves.toContain("image.png");
    await expect(
      readFile("app/__generated__/$resources.sitemap.xml.ts", "utf8")
    ).resolves.toContain('"path": "/"');
    await expect(
      readFile("app/__generated__/$resources.wsauth.server.ts", "utf8")
    ).resolves.toContain("wsauth");
    await expect(readFile(".webstudio/auth.json", "utf8")).resolves.toContain(
      "{}"
    );

    const routeTemplate = await readFile("app/routes/_index.tsx", "utf8");
    expect(routeTemplate).toContain("../__generated__/_index");
    expect(routeTemplate).toContain("../__generated__/_index.server");
    expect(routeTemplate).not.toContain("__CLIENT__");
    expect(routeTemplate).not.toContain("__SERVER__");

    await expect(
      readFile("app/__generated__/stale.ts", "utf8")
    ).rejects.toThrow("ENOENT");
    await expect(readFile("app/routes/stale.tsx", "utf8")).rejects.toThrow(
      "ENOENT"
    );

    const generatedPaths = await getFilePaths("app");
    expect(generatedPaths).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("dl.php"),
        expect.stringContaining("filename=file.pdf"),
        expect.stringContaining("über"),
      ])
    );
  });

  test("selects react-router templates", async () => {
    await prebuild({
      assets: false,
      template: ["react-router", "react-router-vercel"],
    });

    await expect(readFile("app/routes.ts", "utf8")).resolves.toContain(
      "react-router"
    );
    await expect(readFile("app/root.tsx", "utf8")).resolves.toContain(
      "react-router"
    );
    await expect(readFile("app/routes/_index.tsx", "utf8")).resolves.toContain(
      'from "react-router"'
    );
    await expect(
      readFile("app/__generated__/$resources.redirects.ts", "utf8")
    ).resolves.toContain("/dl.php?filename=file.pdf");
  });

  // OrganizeOS fork: the OrganizeOS blocks ship inside the site as a copy of
  // their build (organizeos-components.ts).
  const organizeosDir = join("app", "__organizeos__");

  const expectCopyToBeTheClosure = async () => {
    const entryPath = resolveOrganizeosComponentsModule();
    const { modules } = await findModuleClosure(entryPath);
    const copied = await getFilePaths(organizeosDir);
    expect(copied.map((path) => relative(organizeosDir, path)).sort()).toEqual(
      modules.map((path) => relative(dirname(entryPath), path)).sort()
    );
  };

  test("imports the OrganizeOS blocks from the copy of their build", async () => {
    await writeSiteData(
      createSiteData({
        instances: [
          [
            "root",
            {
              id: "root",
              component: "Box",
              children: [{ type: "id", value: "signup" }],
            },
          ],
          [
            "signup",
            {
              id: "signup",
              component: "@organizeos/site-components:SignupForm",
              children: [],
            },
          ],
        ],
      })
    );

    await prebuild({
      assets: false,
      template: ["react-router", "react-router-vercel"],
    });

    // The page module sits in app/__generated__/ and imports the block by a
    // path relative to that folder, which reaches the copy.
    const pagePath = join("app", "__generated__", "_index.tsx");
    const page = await readFile(pagePath, "utf8");
    const importSource = page.match(
      /import \{ SignupForm as \w+ \} from "([^"]+)";/
    )?.[1];
    expect(importSource).toBe("../__organizeos__/components.js");
    await expect(
      readFile(join(dirname(pagePath), importSource as string), "utf8")
    ).resolves.toEqual(
      await readFile(resolveOrganizeosComponentsModule(), "utf8")
    );
    // Everything the copy imports came with it, and nothing else did.
    await expectCopyToBeTheClosure();
  });

  test("a second prebuild in the same folder leaves no stale file in the OrganizeOS copy", async () => {
    await prebuild({
      assets: false,
      template: ["react-router", "react-router-vercel"],
    });
    await writeFile(join(organizeosDir, "stale.js"), "stale", "utf8");
    await mkdir(join(organizeosDir, "removed"), { recursive: true });
    await writeFile(join(organizeosDir, "removed", "part.js"), "stale", "utf8");

    await prebuild({
      assets: false,
      template: ["react-router", "react-router-vercel"],
    });

    await expectCopyToBeTheClosure();
  });

  // OrganizeOS fork: a page loads a data source only when its scope is on the
  // page or is :root, so the Forms preset, as the builder writes it, is
  // scoped at :root.
  describe("compiles a Signup Form's data from the Forms preset", () => {
    const formsBinding = {
      type: "resource",
      id: "forms-binding",
      name: "OrganizeOS Forms",
      resourceId: "forms-resource",
    };

    const writeSignupForm = (binding: Record<string, unknown>) =>
      writeSiteData(
        createSiteData({
          instances: [
            [
              "root",
              {
                id: "root",
                component: "Box",
                children: [{ type: "id", value: "signup" }],
              },
            ],
            [
              "signup",
              {
                id: "signup",
                component: "@organizeos/site-components:SignupForm",
                children: [],
              },
            ],
          ],
          props: [
            [
              "signup-data",
              {
                id: "signup-data",
                instanceId: "signup",
                name: "data",
                type: "expression",
                value: `${encodeDataSourceVariable(formsBinding.id)}.data`,
              },
            ],
          ],
          dataSources: [[formsBinding.id, binding]],
          resources: [
            [
              "forms-resource",
              {
                id: "forms-resource",
                name: "OrganizeOS Forms",
                method: "get",
                url: `"https://app.example.org/api/public/v1/forms"`,
                headers: [
                  { name: "Authorization", value: `"Bearer osk_test"` },
                ],
              },
            ],
          ],
        })
      );

    const prebuildPage = async () => {
      await prebuild({
        assets: false,
        template: ["react-router", "react-router-vercel"],
      });
      const generatedDir = join("app", "__generated__");
      return {
        page: await readFile(join(generatedDir, "_index.tsx"), "utf8"),
        // the page's resources module, which its loader runs on the server
        resources: await readFile(
          join(generatedDir, "_index.server.tsx"),
          "utf8"
        ),
      };
    };

    test("to the Forms resource when the binding is scoped at :root", async () => {
      await writeSignupForm({ ...formsBinding, scopeInstanceId: ":root" });

      const { page, resources } = await prebuildPage();

      const [, variable, request] =
        page.match(/let (\w+) = useResource\("(\w+)"\)/) ?? [];
      expect(variable).toBeDefined();
      expect(page).toContain(`data={${variable}?.data}`);
      expect(resources).toContain(`const ${request}: ResourceRequest = {`);
      expect(resources).toContain(
        `url: "https://app.example.org/api/public/v1/forms",`
      );
      expect(resources).toContain(
        `{ name: "Authorization", value: "Bearer osk_test" },`
      );
      expect(resources).toContain(`["${request}", ${request}],`);
    });

    test("to undefined when the binding has no scope", async () => {
      await writeSignupForm(formsBinding);

      const { page, resources } = await prebuildPage();

      expect(page).toContain("data={undefined?.data}");
      expect(page).not.toContain("useResource(");
      expect(resources).not.toContain("/v1/forms");
      expect(resources).not.toContain("OrganizeOS Forms");
    });
  });

  // OrganizeOS fork: every page route's loader fetches its resources through
  // the in-memory cache the react-router template carries
  // (templates/react-router/app/organizeos-resource-cache.ts).
  describe("routes resource fetches through the resource cache", () => {
    const cacheModule = join("app", "organizeos-resource-cache.ts");
    const routes = [
      {
        documentType: "html",
        file: join("app", "routes", "_index.tsx"),
        cache: `createResourceCache({\n  fetch: (input, init) => cachedFetch(projectId, input, init),\n})`,
      },
      {
        documentType: "xml",
        file: join("app", "routes", "[feed.xml]._index.tsx"),
        cache: "createResourceCache()",
      },
      {
        documentType: "text",
        file: join("app", "routes", "[notes.txt]._index.tsx"),
        cache: "createResourceCache()",
      },
    ];

    /** The body of a route's customFetch, up to its closing brace. */
    const getCustomFetch = (route: string) => {
      const start = route.indexOf("const customFetch: typeof fetch");
      return route.slice(start, route.indexOf("\n};\n", start));
    };

    beforeEach(async () => {
      await writeSiteData(
        createSiteData({
          pages: [
            {
              id: "home",
              name: "Home",
              title: "Home",
              path: "",
              rootInstanceId: "root",
              meta: {},
            },
            {
              id: "feed",
              name: "Feed",
              title: "Feed",
              path: "/feed.xml",
              rootInstanceId: "xml-root",
              meta: { documentType: "xml" },
            },
            {
              id: "notes",
              name: "Notes",
              title: "Notes",
              path: "/notes.txt",
              rootInstanceId: "root",
              meta: { documentType: "text" },
            },
          ],
          instances: [
            ["root", { id: "root", component: "Box", children: [] }],
            [
              "xml-root",
              {
                id: "xml-root",
                component: "Box",
                children: [{ type: "id", value: "xml-feed" }],
              },
            ],
            [
              "xml-feed",
              {
                id: "xml-feed",
                component: elementComponent,
                tag: "rss",
                children: [],
              },
            ],
          ],
        })
      );
      await prebuild({
        assets: false,
        template: ["react-router", "react-router-vercel"],
      });
    });

    test("copies the cache module into the site unchanged", async () => {
      await expect(readFile(cacheModule, "utf8")).resolves.toEqual(
        await readFile(
          new URL(
            "../templates/react-router/app/organizeos-resource-cache.ts",
            import.meta.url
          ),
          "utf8"
        )
      );
    });

    test.each(routes)(
      "the $documentType route makes one cache and its customFetch falls back to it",
      async ({ file, cache }) => {
        const route = await readFile(file, "utf8");

        expect(route).toContain(
          `import { createResourceCache } from "../organizeos-resource-cache";`
        );
        // The import, from app/routes/, reaches the copied module.
        expect(join(dirname(file), "../organizeos-resource-cache.ts")).toBe(
          cacheModule
        );
        // Made once, at module scope, never per request.
        expect(route.match(/createResourceCache\(/g)).toHaveLength(1);
        expect(route).toContain(`\nconst resourceCache = ${cache};\n`);
        expect(getCustomFetch(route).trimEnd().split("\n").at(-1)).toBe(
          "  return resourceCache(input, init);"
        );
      }
    );

    test("the form action still posts with plain fetch", async () => {
      const route = await readFile(routes[0].file, "utf8");
      const action = route.slice(route.indexOf("export const action"));

      expect(action).toContain(
        "const { ok, statusText } = await loadResource(fetch, resource);"
      );
      expect(action).not.toContain("resourceCache");
      expect(action).not.toContain("customFetch");
    });
  });

  test("selects ssg templates and skips dynamic routes", async () => {
    await writeSiteData(
      createSiteData({
        pages: [
          {
            id: "home",
            name: "Home",
            title: "Home",
            path: "",
            rootInstanceId: "root",
            meta: {},
          },
          {
            id: "post",
            name: "Post",
            title: "Post",
            path: "/blog/:slug",
            rootInstanceId: "root",
            meta: {},
          },
        ],
      })
    );

    await prebuild({
      assets: false,
      template: ["ssg"],
    });

    await expect(readFile("pages/index/+Page.tsx", "utf8")).resolves.toContain(
      "../app/__generated__/_index"
    );
    await expect(readFile("pages/index/+data.ts", "utf8")).resolves.toContain(
      "../app/__generated__/_index.server"
    );
    await expect(
      readFile("pages/blog/:slug/+Page.tsx", "utf8")
    ).rejects.toThrow("ENOENT");
    await expect(
      readFile("app/__generated__/[blog].$slug._index.tsx", "utf8")
    ).resolves.toContain("export { Page }");
  });

  test("generates html, xml, and text document routes", async () => {
    await writeSiteData(
      createSiteData({
        pages: [
          {
            id: "home",
            name: "Home",
            title: "Home",
            path: "",
            rootInstanceId: "root",
            meta: {},
          },
          {
            id: "feed",
            name: "Feed",
            title: "Feed",
            path: "/feed.xml",
            rootInstanceId: "xml-root",
            meta: {
              documentType: "xml",
            },
          },
          {
            id: "robots",
            name: "Robots",
            title: "Robots",
            path: "/robots.txt",
            rootInstanceId: "root",
            meta: {
              documentType: "text",
            },
          },
        ],
        instances: [
          [
            "root",
            {
              id: "root",
              component: "Box",
              children: [],
            },
          ],
          [
            "xml-root",
            {
              id: "xml-root",
              component: "Box",
              children: [{ type: "id", value: "xml-feed" }],
            },
          ],
          [
            "xml-feed",
            {
              id: "xml-feed",
              component: elementComponent,
              tag: "rss",
              children: [],
            },
          ],
        ],
      })
    );

    await prebuild({
      assets: false,
      template: ["defaults"],
    });

    await expect(readFile("app/routes/_index.tsx", "utf8")).resolves.toContain(
      "useLoaderData"
    );
    await expect(
      readFile("app/routes/[feed.xml]._index.tsx", "utf8")
    ).resolves.toContain("renderToString");
    await expect(
      readFile("app/routes/[robots.txt]._index.tsx", "utf8")
    ).resolves.toContain("Content-Type");
  });

  test("generates custom code only for the home page", async () => {
    await writeSiteData(
      createSiteData({
        pageMeta: {
          code: '<script src="/custom.js"></script><style>.x{color:red}</style>',
        },
        pages: [
          {
            id: "home",
            name: "Home",
            title: "Home",
            path: "",
            rootInstanceId: "root",
            meta: {},
          },
          {
            id: "about",
            name: "About",
            title: "About",
            path: "/about",
            rootInstanceId: "root",
            meta: {},
          },
        ],
      })
    );

    await prebuild({
      assets: false,
      template: ["defaults"],
    });

    await expect(
      readFile("app/__generated__/_index.tsx", "utf8")
    ).resolves.toContain("CustomCode");
    await expect(
      readFile("app/__generated__/[about]._index.tsx", "utf8")
    ).resolves.not.toContain("CustomCode");
  });

  test(
    "downloads assets only when requested by prebuild",
    async () => {
      const fetch = vi.fn(async () => ({
        ok: false,
        statusText: "Not Found",
      }));
      globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
      const consoleWarn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await prebuild({
        assets: false,
        template: ["defaults"],
      });
      expect(fetch).not.toHaveBeenCalled();

      await prebuild({
        assets: true,
        template: ["defaults"],
      });
      expect(fetch).toHaveBeenCalledWith(
        "https://assets.example/cgi/image/image.png?format=raw"
      );
      expect(consoleWarn).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("Error materializing file image.png")
      );
    },
    slowPrebuildTestTimeout
  );

  test("uses synced asset files before downloading during prebuild", async () => {
    await mkdir(".webstudio/assets", { recursive: true });
    await writeFile(".webstudio/assets/image.png", "synced", "utf8");
    const fetch = vi.fn();
    globalThis.fetch = fetch;

    await prebuild({
      assets: true,
      template: ["defaults"],
    });

    await expect(readFile("public/assets/image.png", "utf8")).resolves.toBe(
      "synced"
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test("merges package and tsconfig from every template", async () => {
    const localTemplate = join(tempDir, "local-template");
    await mkdir(localTemplate, { recursive: true });
    await writeFile(
      join(localTemplate, "package.json"),
      JSON.stringify({
        scripts: {
          local: "echo local",
        },
        dependencies: {
          "local-package": "1.0.0",
        },
      }),
      "utf8"
    );
    await writeFile(
      join(localTemplate, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: false,
          paths: {
            "~local/*": ["./local/*"],
          },
        },
      }),
      "utf8"
    );
    await writeFile(
      "package.json",
      JSON.stringify({
        scripts: {
          existing: "echo existing",
        },
        dependencies: {
          existing: "1.0.0",
        },
      }),
      "utf8"
    );
    await writeFile(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          strict: true,
          paths: {
            "~existing/*": ["./existing/*"],
          },
        },
      }),
      "utf8"
    );

    await prebuild({
      assets: false,
      template: ["defaults", localTemplate],
    });

    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    expect(packageJson.scripts.existing).toEqual("echo existing");
    expect(packageJson.scripts.local).toEqual("echo local");
    expect(packageJson.dependencies.existing).toEqual("1.0.0");
    expect(packageJson.dependencies["local-package"]).toEqual("1.0.0");

    const tsconfig = JSON.parse(await readFile("tsconfig.json", "utf8"));
    expect(tsconfig.compilerOptions.strict).toEqual(false);
    expect(tsconfig.compilerOptions.paths).toEqual({
      "~existing/*": ["./existing/*"],
      "~local/*": ["./local/*"],
    });
  });

  test("throws when project bundle is missing", async () => {
    await rm(".webstudio/data.json", { force: true });

    await expect(
      prebuild({
        assets: false,
        template: ["defaults"],
      })
    ).rejects.toThrow("Project bundle is missing");
  });

  test("throws when project bundle is invalid", async () => {
    await writeFile(".webstudio/data.json", JSON.stringify({ assets: [] }));

    await expect(
      prebuild({
        assets: false,
        template: ["defaults"],
      })
    ).rejects.toThrow(
      "Project bundle is invalid, please make sure the project is synced. Invalid fields: page: Required"
    );
  });
});
