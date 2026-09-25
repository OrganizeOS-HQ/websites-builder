import { afterEach, describe, expect, test, vi } from "vitest";

// Routes read the environment once, when first imported
vi.hoisted(() => {
  Object.assign(process.env, {
    S3_ENDPOINT: "https://ref.supabase.co/storage/v1/s3",
    S3_REGION: "us-east-1",
    S3_ACCESS_KEY_ID: "AKIDEXAMPLE",
    S3_SECRET_ACCESS_KEY: "secret",
    S3_BUCKET: "builder-assets",
  });
});

import { loader as assetLoader } from "~/routes/cgi.asset.$";
import { loader as imageLoader } from "~/routes/cgi.image.$";
import { loader as videoLoader } from "~/routes/cgi.video.$";

type Loader = typeof assetLoader;

const load = async (loader: Loader, path: string, init?: RequestInit) => {
  try {
    return await loader({
      request: new Request(`https://builder.test${path}`, init),
      params: {},
      context: {},
    });
  } catch (thrown) {
    if (thrown instanceof Response) {
      return thrown;
    }
    throw thrown;
  }
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const routes: Array<[string, Loader]> = [
  ["asset", assetLoader],
  ["image", imageLoader],
  ["video", videoLoader],
];

describe.each(routes)("/cgi/%s", (route, loader) => {
  test("serves an upload from the bucket, sandboxed", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", async (url: URL) => {
      requested.push(url.href);
      return new Response(new Uint8Array([137, 80, 78, 71]));
    });

    const response = await load(loader, `/cgi/${route}/photo_x.png?format=raw`);

    expect(requested).toEqual([
      "https://ref.supabase.co/storage/v1/s3/builder-assets/photo_x.png",
    ]);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Security-Policy")).toBe("sandbox");
  });

  test("keeps a remote page's cookies and script off the builder", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("<script>steal()</script>", {
          headers: {
            "Content-Type": "text/html",
            "Set-Cookie": "session=attacker; Domain=organizeos.org",
          },
        })
    );

    const response = await load(
      loader,
      `/cgi/${route}/${encodeURIComponent("https://remote.test/x.html")}`
    );

    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Content-Security-Policy")).toBe("sandbox");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
