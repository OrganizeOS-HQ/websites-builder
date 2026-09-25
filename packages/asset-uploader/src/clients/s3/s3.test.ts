import { afterEach, describe, expect, test, vi } from "vitest";
import { getS3ObjectUrl } from "./object-url";
import { createS3Client } from "./s3";

const options = {
  endpoint: "https://ref.supabase.co/storage/v1/s3",
  region: "us-east-1",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "secret",
  bucket: "builder-assets",
  maxUploadSize: 1024 * 1024,
};

type SentRequest = { url: string; method?: string; headers: Headers };

const stubStorage = (respond: () => Response) => {
  const sent: SentRequest[] = [];
  vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
    sent.push({
      url: url.href,
      method: init.method,
      headers: new Headers(init.headers),
    });
    return respond();
  });
  return sent;
};

const signedHeaders = (headers: Headers) =>
  headers.get("authorization")?.match(/SignedHeaders=([^,]+)/)?.[1];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getS3ObjectUrl", () => {
  test("appends bucket and key to an endpoint without a path", () => {
    const url = getS3ObjectUrl({
      endpoint: "https://account.r2.cloudflarestorage.com",
      bucket: "builder-assets",
      name: "photo_x.png",
    });
    expect(url.href).toBe(
      "https://account.r2.cloudflarestorage.com/builder-assets/photo_x.png"
    );
  });

  test("keeps the endpoint's path", () => {
    const url = getS3ObjectUrl({
      endpoint: "https://ref.supabase.co/storage/v1/s3/",
      bucket: "builder-assets",
      name: "photo_x.png",
    });
    expect(url.href).toBe(
      "https://ref.supabase.co/storage/v1/s3/builder-assets/photo_x.png"
    );
  });

  test("encodes the key as a single path segment", () => {
    const url = getS3ObjectUrl({
      endpoint: "http://localhost:9000",
      bucket: "builder-assets",
      name: "фото (1)!*/x.png",
    });
    expect(url.pathname).toBe(
      "/builder-assets/%D1%84%D0%BE%D1%82%D0%BE%20%281%29%21%2A%2Fx.png"
    );
  });

  test.each(["", ".", ".."])(
    "refuses %j, which would address the bucket or the service",
    (name) => {
      expect(() =>
        getS3ObjectUrl({ endpoint: "https://s3.test", bucket: "b", name })
      ).toThrow();
    }
  );
});

describe("readFile", () => {
  test("sends a signed GET for the object", async () => {
    const sent = stubStorage(() => new Response("bytes"));

    const response = await createS3Client(options).readFile?.("photo_x.png", {
      range: "bytes=0-1",
    });

    expect(await response?.text()).toBe("bytes");
    expect(sent).toHaveLength(1);
    const [request] = sent;
    expect(request.method).toBe("GET");
    expect(request.url).toBe(
      "https://ref.supabase.co/storage/v1/s3/builder-assets/photo_x.png"
    );
    expect(signedHeaders(request.headers)).toBe(
      "host;range;x-amz-content-sha256;x-amz-date"
    );
    // signed, but sent by fetch itself from the URL
    expect(request.headers.has("host")).toBe(false);
    expect(request.headers.get("range")).toBe("bytes=0-1");
    expect(request.headers.get("accept-encoding")).toBe("identity");
  });

  test("resolves to undefined for a missing object", async () => {
    stubStorage(
      () =>
        new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 })
    );
    expect(
      await createS3Client(options).readFile?.("photo_x.png")
    ).toBeUndefined();
  });

  test("throws on any other storage error, without its body", async () => {
    stubStorage(
      () =>
        new Response("<Error><Code>AccessDenied</Code></Error>", {
          status: 403,
        })
    );
    await expect(
      createS3Client(options).readFile?.("photo_x.png")
    ).rejects.toThrow(/^Cannot read file photo_x\.png: storage responded 403$/);
  });

  test.each([206, 416])("returns a %i answer to a range", async (status) => {
    stubStorage(
      () =>
        new Response(null, {
          status,
          headers: { "content-range": "bytes */4" },
        })
    );
    const response = await createS3Client(options).readFile?.("clip_x.mp4", {
      range: "bytes=9-",
    });
    expect(response?.status).toBe(status);
  });
});

describe("uploadFile", () => {
  test("PUTs the object under the endpoint's path", async () => {
    const sent = stubStorage(() => new Response(null, { status: 200 }));

    const asset = await createS3Client(options).uploadFile(
      "clip_x.mp4",
      "video",
      (async function* () {
        yield new Uint8Array([1, 2, 3]);
      })(),
      { width: 640, height: 360, format: "mp4" }
    );

    expect(asset.size).toBe(3);
    const [request] = sent;
    expect(request.method).toBe("PUT");
    expect(request.url).toBe(
      "https://ref.supabase.co/storage/v1/s3/builder-assets/clip_x.mp4"
    );
    expect(signedHeaders(request.headers)).toContain("host;");
    expect(request.headers.has("host")).toBe(false);
    expect(request.headers.get("content-type")).toBe("video/mp4");
  });
});
