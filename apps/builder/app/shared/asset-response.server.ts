import type { AssetClient } from "@webstudio-is/asset-uploader/index.server";
import { getMimeTypeByFilename, isAllowedExtension } from "@webstudio-is/sdk";

/**
 * Headers for a file the /cgi routes return from the builder's own origin.
 *
 * An uploaded .html or .svg, or a page fetched for the canvas, must never run
 * as a page of the builder: its script would act with the signed-in admin's
 * session. A sandboxed document gets no origin and no script, while images,
 * fonts and media loaded by the canvas ignore the policy.
 */
export const assetResponseHeaders = (contentType: string): Headers => {
  const headers = new Headers({
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  // A PDF cannot script the page it is shown on, and browsers' PDF viewers
  // may refuse to render in a sandboxed document.
  const essence = contentType.split(";")[0].trim().toLowerCase();
  if (essence !== "application/pdf") {
    headers.set("Content-Security-Policy", "sandbox");
  }
  return headers;
};

/**
 * Whether `name` can be an uploaded file: one path segment with an allowed
 * extension. Checked before a name reaches storage, where "." or "" would
 * address the bucket itself instead of an object in it.
 */
export const isUploadedFileName = (name: string): boolean => {
  if (name === "." || name === ".." || /[/\\]/.test(name)) {
    return false;
  }
  const dot = name.lastIndexOf(".");
  return dot > 0 && isAllowedExtension(name.slice(dot + 1));
};

const copyHeaders = (from: Headers, to: Headers, names: string[]) => {
  for (const name of names) {
    const value = from.get(name);
    if (value !== null) {
      to.set(name, value);
    }
  }
};

/**
 * Streams an uploaded file back from storage, typed by its name. Resolves to
 * undefined when the client cannot read files back (the fs client), and the
 * route reads its directory instead.
 */
export const serveStoredAsset = async ({
  client,
  name,
  request,
  headers: routeHeaders,
}: {
  client: AssetClient;
  name: string;
  request: Request;
  headers?: HeadersInit;
}): Promise<Response | undefined> => {
  if (client.readFile === undefined) {
    return;
  }
  if (isUploadedFileName(name) === false) {
    throw new Response("Not found", { status: 404 });
  }

  let stored: Response | undefined;
  try {
    stored = await client.readFile(name, {
      range: request.headers.get("range") ?? undefined,
    });
  } catch (error) {
    console.error(error);
    throw new Response("Asset storage is unavailable", { status: 502 });
  }
  if (stored === undefined) {
    throw new Response("Not found", { status: 404 });
  }

  const headers = assetResponseHeaders(getMimeTypeByFilename(name));
  copyHeaders(stored.headers, headers, [
    "Cache-Control",
    "ETag",
    "Last-Modified",
    "Accept-Ranges",
    "Content-Range",
  ]);
  if (stored.headers.has("Content-Encoding") === false) {
    copyHeaders(stored.headers, headers, ["Content-Length"]);
  }
  new Headers(routeHeaders).forEach((value, key) => headers.set(key, value));

  if (stored.status === 416) {
    // the body is the provider's error document
    await stored.body?.cancel();
    headers.delete("Content-Length");
    return new Response(null, { status: 416, headers });
  }
  return new Response(stored.body, { status: stored.status, headers });
};

/**
 * Fetches a file the canvas references by URL: an Image or Video whose src is
 * absolute loads through these routes. Only http(s) is fetched, and only
 * content headers come back, so the remote cannot set cookies on the builder's
 * domain.
 */
export const proxyRemoteAsset = async (href: string): Promise<Response> => {
  const url = new URL(href);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Response("Not found", { status: 404 });
  }
  const remote = await fetch(url);
  const headers = assetResponseHeaders(
    remote.headers.get("Content-Type") ?? "application/octet-stream"
  );
  copyHeaders(remote.headers, headers, [
    "Cache-Control",
    "ETag",
    "Last-Modified",
  ]);
  return new Response(remote.body, { status: remote.status, headers });
};
