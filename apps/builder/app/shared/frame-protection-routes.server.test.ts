import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
import type { HeadersArgs } from "@remix-run/server-runtime";

// The routes read the environment once, when first imported. Without a secret
// the session modules warn that their cookies are not signed.
vi.hoisted(() => {
  Object.assign(process.env, { AUTH_SECRET: "test-secret" });
});

import { headers as rootHeaders } from "~/root";
import { headers as builderHeaders } from "~/routes/_ui.(builder)";
import { headers as dashboardHeaders } from "~/routes/_ui.dashboard";
import { headers as catchAllHeaders } from "~/routes/_ui.$";
import { privateNoStoreResponseHeaders } from "~/services/cache-control.server";

// The arguments Remix passes to a route's `headers` function. The Headers
// objects are passed on as they are, to see whether the route changes them.
const remixArgs = (init?: {
  loaderHeaders?: Headers;
  errorHeaders?: Headers;
}): HeadersArgs => ({
  loaderHeaders: init?.loaderHeaders ?? new Headers(),
  parentHeaders: new Headers(),
  actionHeaders: new Headers(),
  errorHeaders: init?.errorHeaders,
});

// Remix turns what `headers` returns into the document's headers like this.
// Comparing exact values also shows there is one policy: a second one
// would come back joined with a comma.
const documentHeaders = (result: Headers | HeadersInit) => new Headers(result);

const expectFrameProtection = (headers: Headers, policy?: string) => {
  expect(headers.get("Content-Security-Policy")).toBe(
    policy ?? "frame-ancestors 'self'"
  );
  expect(headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
};

const expectNoStore = (headers: Headers) => {
  expect(headers.get("Cache-Control")).toContain("no-store");
  for (const [name, value] of Object.entries(privateNoStoreResponseHeaders)) {
    expect(headers.get(name)).toBe(value);
  }
};

describe("root", () => {
  test("sends the frame protection that every route without `headers` inherits", () => {
    expect(
      Object.fromEntries(documentHeaders(rootHeaders(remixArgs())))
    ).toEqual({
      "content-security-policy": "frame-ancestors 'self'",
      "x-frame-options": "SAMEORIGIN",
    });
  });
});

describe("the builder route", () => {
  // What its loader sets
  const loaderPolicy =
    "frame-src https://builder.test/canvas https://app.goentri.com/; worker-src blob:";
  const loaderHeaders = () =>
    new Headers({ "Content-Security-Policy": loaderPolicy });

  test("keeps the loader's frame-src and worker-src and adds frame-ancestors to the same policy", () => {
    const headers = documentHeaders(
      builderHeaders(remixArgs({ loaderHeaders: loaderHeaders() }))
    );

    expectFrameProtection(headers, `${loaderPolicy}; frame-ancestors 'self'`);
  });

  test("is still not cached", () => {
    expectNoStore(
      documentHeaders(
        builderHeaders(remixArgs({ loaderHeaders: loaderHeaders() }))
      )
    );
  });

  test("sends frame-ancestors alone when the loader set no policy, as on an error page", () => {
    const headers = documentHeaders(builderHeaders(remixArgs()));

    expectFrameProtection(headers);
    expectNoStore(headers);
  });
});

describe("the dashboard route", () => {
  test("is not cached and cannot be framed", () => {
    const headers = documentHeaders(dashboardHeaders());

    expectNoStore(headers);
    expectFrameProtection(headers);
  });
});

describe("the catch-all route", () => {
  test("keeps only the Cache-Control of a missing asset's 404, so Vercel does not cache it for good", () => {
    // What the loader throws for /assets/*, as Remix hands it to `headers`
    const { headers: thrown } = new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
    });
    expect(thrown.has("Content-Type")).toBe(true);

    const headers = documentHeaders(
      catchAllHeaders(
        remixArgs({ loaderHeaders: thrown, errorHeaders: thrown })
      )
    );

    expect(headers.get("Cache-Control")).toBe(
      "public, max-age=0, must-revalidate"
    );
    expectFrameProtection(headers);
    // Nothing else comes along, as before
    expect([...headers.keys()].sort()).toEqual([
      "cache-control",
      "content-security-policy",
      "x-frame-options",
    ]);
  });

  test("otherwise passes the loader's headers on and adds the frame protection", () => {
    // What the loader throws for any other path
    const { headers: thrown } = new Response("Not found", { status: 404 });
    thrown.append("Set-Cookie", "first=1; Path=/");
    thrown.append("Set-Cookie", "second=2; Path=/");

    const headers = documentHeaders(
      catchAllHeaders(
        remixArgs({ loaderHeaders: thrown, errorHeaders: thrown })
      )
    );

    expect(headers.get("Content-Type")).toBe("text/plain;charset=UTF-8");
    expect(headers.getSetCookie()).toEqual([
      "first=1; Path=/",
      "second=2; Path=/",
    ]);
    // Not given a Cache-Control it did not have
    expect(headers.has("Cache-Control")).toBe(false);
    expectFrameProtection(headers);
  });

  test("passes the loader's headers on when there is no error at all", () => {
    const headers = documentHeaders(
      catchAllHeaders(
        remixArgs({ loaderHeaders: new Headers({ "X-Probe": "1" }) })
      )
    );

    expect(headers.get("X-Probe")).toBe("1");
    expectFrameProtection(headers);
  });

  test("adds frame-ancestors to a policy the loader set, and leaves the loader's headers alone", () => {
    const loaderHeaders = new Headers({
      "Content-Security-Policy": "worker-src blob:",
    });

    const headers = documentHeaders(
      catchAllHeaders(remixArgs({ loaderHeaders }))
    );

    expectFrameProtection(headers, "worker-src blob:; frame-ancestors 'self'");
    expect([...loaderHeaders.keys()]).toEqual(["content-security-policy"]);
    expect(loaderHeaders.get("Content-Security-Policy")).toBe(
      "worker-src blob:"
    );
  });
});

// Remix gives a route that exports `headers` those headers alone (plus
// Set-Cookie), not the root's. So a route that exports `headers` and does not
// merge the frame protection in would be framable, silently.
describe("routes that export `headers`", () => {
  const routesDirectory = fileURLToPath(new URL("../routes", import.meta.url));

  const withoutComments = (source: string) =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:\\])\/\/.*$/gm, "$1");

  const exportsHeaders = (source: string) => {
    const code = withoutComments(source);
    return (
      // export const headers = ..., export function headers() {...}
      /\bexport\s+(?:async\s+)?(?:const|let|var|function)\s+headers\b/.test(
        code
      ) ||
      // export { headers }, export { other as headers } from "..."
      /\bexport\s*\{[^}]*\bheaders\b[^}]*\}/.test(code)
    );
  };

  // Used, not just imported
  const mergesFrameProtection = (source: string) =>
    /\b(?:frameProtectionHeaders|withFrameAncestors)\b/.test(
      withoutComments(source).replace(/^import\b[^;]*;/gm, "")
    );

  const routes = readdirSync(routesDirectory, {
    recursive: true,
    encoding: "utf8",
  })
    .filter((file) => /\.[cm]?[jt]sx?$/.test(file))
    .sort()
    .map((file) => ({
      file,
      source: readFileSync(join(routesDirectory, file), "utf8"),
    }));

  const routesWithHeaders = routes.filter(({ source }) =>
    exportsHeaders(source)
  );

  test("are found, so the check below is not empty", () => {
    expect(routesWithHeaders.map(({ file }) => file)).toEqual(
      expect.arrayContaining([
        "_ui.$.tsx",
        "_ui.(builder).tsx",
        "_ui.dashboard.tsx",
      ])
    );
  });

  test("all merge the frame protection into them (shared/frame-protection.ts)", () => {
    const unprotected = routesWithHeaders
      .filter(({ source }) => mergesFrameProtection(source) === false)
      .map(({ file }) => file);

    expect(
      unprotected,
      "These routes export `headers` without frameProtectionHeaders or withFrameAncestors, so Remix drops root's frame-ancestors for them"
    ).toEqual([]);
  });

  test("are recognised however they are exported, and the frame protection by its use", () => {
    for (const source of [
      "export const headers = () => ({});",
      "export const headers: HeadersFunction = () => ({});",
      "export function headers() { return {}; }",
      "export async function headers() { return {}; }",
      "const headers = () => ({});\nexport { headers };",
      'export { headers } from "./other";',
      'export { other as headers } from "./other";',
    ]) {
      expect(exportsHeaders(source), source).toBe(true);
    }

    for (const source of [
      "export const loader = () => new Headers();",
      "export const headersFor = () => ({});",
      "const headers = () => ({});",
      "// export const headers = () => ({});",
      "/* export const headers = () => ({}); */",
    ]) {
      expect(exportsHeaders(source), source).toBe(false);
    }

    expect(mergesFrameProtection("// frameProtectionHeaders")).toBe(false);
    expect(
      mergesFrameProtection(
        'import { frameProtectionHeaders } from "~/shared/frame-protection";\nexport const headers = () => ({});'
      )
    ).toBe(false);
    expect(mergesFrameProtection("() => ({ ...frameProtectionHeaders })")).toBe(
      true
    );
    expect(
      mergesFrameProtection("withFrameAncestors(loaderHeaders.get('x'))")
    ).toBe(true);
  });
});
