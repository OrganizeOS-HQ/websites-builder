import { afterEach, describe, expect, test, vi } from "vitest";
import type { AssetClient } from "@webstudio-is/asset-uploader/index.server";
import {
  assetResponseHeaders,
  isUploadedFileName,
  proxyRemoteAsset,
  serveStoredAsset,
} from "./asset-response.server";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const request = (headers?: HeadersInit) =>
  new Request("https://builder.test/cgi/asset/file", { headers });

const storage = (readFile?: AssetClient["readFile"]): AssetClient => ({
  uploadFile: vi.fn(),
  readFile,
});

/** Loader helpers throw their error Responses; settle either outcome. */
const settle = async (pending: Promise<Response | undefined>) => {
  try {
    return await pending;
  } catch (thrown) {
    if (thrown instanceof Response) {
      return thrown;
    }
    throw thrown;
  }
};

describe("assetResponseHeaders", () => {
  test.each(["text/html", "image/svg+xml", "application/xml", "image/png"])(
    "sandboxes %s and forbids sniffing",
    (type) => {
      const headers = assetResponseHeaders(type);
      expect(headers.get("Content-Type")).toBe(type);
      expect(headers.get("Content-Security-Policy")).toBe("sandbox");
      expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  );

  test("leaves a PDF viewable", () => {
    expect(
      assetResponseHeaders("application/pdf").has("Content-Security-Policy")
    ).toBe(false);
    expect(
      assetResponseHeaders("Application/PDF; qs=1").has(
        "Content-Security-Policy"
      )
    ).toBe(false);
    // anything else that mentions PDF stays sandboxed
    expect(
      assetResponseHeaders("text/html, application/pdf").get(
        "Content-Security-Policy"
      )
    ).toBe("sandbox");
  });
});

describe("isUploadedFileName", () => {
  test.each(["photo_V1St-GX.png", "фото_1.JPG", "font_x.woff2", "doc_x.pdf"])(
    "accepts %s",
    (name) => {
      expect(isUploadedFileName(name)).toBe(true);
    }
  );

  test.each(["", ".", "..", ".png", "a/b.png", "a\\b.png", "noext", "x.exe"])(
    "refuses %j",
    (name) => {
      expect(isUploadedFileName(name)).toBe(false);
    }
  );
});

describe("serveStoredAsset", () => {
  test("leaves the fs client's files to the route", async () => {
    expect(
      await serveStoredAsset({
        client: storage(),
        name: "photo_x.png",
        request: request(),
      })
    ).toBeUndefined();
  });

  test("refuses a name that is not an uploaded file before asking storage", async () => {
    const readFile = vi.fn();
    const response = await settle(
      serveStoredAsset({
        client: storage(readFile),
        name: ".",
        request: request(),
      })
    );
    expect(response?.status).toBe(404);
    expect(readFile).not.toHaveBeenCalled();
  });

  test("answers 404 for a missing file", async () => {
    const response = await settle(
      serveStoredAsset({
        client: storage(async () => undefined),
        name: "photo_x.png",
        request: request(),
      })
    );
    expect(response?.status).toBe(404);
  });

  test("answers 502 without detail when storage fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await settle(
      serveStoredAsset({
        client: storage(async () => {
          throw Error("Cannot read file photo_x.png: storage responded 403");
        }),
        name: "photo_x.png",
        request: request(),
      })
    );
    expect(response?.status).toBe(502);
    expect(await response?.text()).not.toMatch(/403|photo_x/);
  });

  test("streams the file typed by its name, with storage's cache headers only", async () => {
    const readFile = vi.fn(
      async () =>
        new Response("<svg/>", {
          headers: {
            "Content-Type": "text/html",
            "Cache-Control": "public, max-age=31536004,immutable",
            ETag: '"e1"',
            "Content-Length": "6",
            "x-amz-request-id": "r1",
          },
        })
    );

    const response = await serveStoredAsset({
      client: storage(readFile),
      name: "logo_x.svg",
      request: request({ range: "bytes=0-" }),
      headers: { "Access-Control-Allow-Origin": "https://builder.test" },
    });

    expect(readFile).toHaveBeenCalledWith("logo_x.svg", { range: "bytes=0-" });
    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe("<svg/>");
    expect(Object.fromEntries(response?.headers ?? [])).toEqual({
      "access-control-allow-origin": "https://builder.test",
      "cache-control": "public, max-age=31536004,immutable",
      "content-length": "6",
      "content-security-policy": "sandbox",
      "content-type": "image/svg+xml",
      etag: '"e1"',
      "x-content-type-options": "nosniff",
    });
  });

  test("passes a partial answer through, so video can seek", async () => {
    const response = await serveStoredAsset({
      client: storage(
        async () =>
          new Response("abcd", {
            status: 206,
            headers: {
              "Accept-Ranges": "bytes",
              "Content-Range": "bytes 0-3/100",
            },
          })
      ),
      name: "clip_x.mp4",
      request: request({ range: "bytes=0-3" }),
    });
    expect(response?.status).toBe(206);
    expect(response?.headers.get("Content-Range")).toBe("bytes 0-3/100");
    expect(response?.headers.get("Accept-Ranges")).toBe("bytes");
  });

  test("drops storage's error document from a 416", async () => {
    const response = await serveStoredAsset({
      client: storage(
        async () =>
          new Response("<Error><Code>InvalidRange</Code></Error>", {
            status: 416,
            headers: { "Content-Range": "bytes */100" },
          })
      ),
      name: "clip_x.mp4",
      request: request({ range: "bytes=200-" }),
    });
    expect(response?.status).toBe(416);
    expect(response?.headers.get("Content-Range")).toBe("bytes */100");
    expect(await response?.text()).toBe("");
  });

  test("omits the length of a body storage encoded", async () => {
    const response = await serveStoredAsset({
      client: storage(
        async () =>
          new Response("x", {
            headers: { "Content-Encoding": "gzip", "Content-Length": "40" },
          })
      ),
      name: "data_x.json",
      request: request(),
    });
    expect(response?.headers.has("Content-Length")).toBe(false);
  });
});

describe("proxyRemoteAsset", () => {
  test.each([
    "data:text/html,<script>alert(1)</script>",
    "javascript:alert(1)",
    "file:///etc/passwd",
  ])("does not fetch %s", async (href) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await settle(proxyRemoteAsset(href));
    expect(response?.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("returns the remote body with content headers only", async () => {
    const remote = new Response("<script>steal()</script>", {
      status: 404,
      headers: {
        "Content-Type": "text/html",
        "Set-Cookie": "session=attacker; Domain=organizeos.org; Path=/",
        "Cache-Control": "max-age=60",
        "Access-Control-Allow-Origin": "*",
      },
    });
    expect(remote.headers.get("Set-Cookie")).not.toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => remote)
    );

    const response = await proxyRemoteAsset("https://remote.test/x.html");

    expect(response.status).toBe(404);
    expect(Object.fromEntries(response.headers)).toEqual({
      "cache-control": "max-age=60",
      "content-security-policy": "sandbox",
      "content-type": "text/html",
      "x-content-type-options": "nosniff",
    });
  });

  test("types an untyped remote body as a download", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1])))
    );
    const response = await proxyRemoteAsset("https://remote.test/blob");
    expect(response.headers.get("Content-Type")).toBe(
      "application/octet-stream"
    );
  });
});
