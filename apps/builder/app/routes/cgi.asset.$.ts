import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { createReadableStreamFromReadable } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/server-runtime";
import {
  getMimeTypeByFilename,
  isAllowedExtension,
  decodePathFragment,
} from "@webstudio-is/sdk";
import { createAssetClient, fileUploadPath } from "~/shared/asset-client";
import {
  assetResponseHeaders,
  proxyRemoteAsset,
  serveStoredAsset,
} from "~/shared/asset-response.server";

// This route serves generic assets without processing
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const basePath = `/cgi/asset/`;

  const url = new URL(request.url);
  const name = decodePathFragment(url.pathname.slice(basePath.length));

  // Allow direct asset access, and from the same origin
  const refererRawUrl = request.headers.get("referer");
  const refererUrl = refererRawUrl === null ? url : new URL(refererRawUrl);
  if (refererUrl.host !== url.host) {
    throw new Response("Forbidden", {
      status: 403,
    });
  }

  // Support absolute urls locally
  if (URL.canParse(name)) {
    return proxyRemoteAsset(name);
  }

  const stored = await serveStoredAsset({
    client: createAssetClient(),
    name,
    request,
    headers: { "Access-Control-Allow-Origin": url.origin },
  });
  if (stored !== undefined) {
    return stored;
  }

  const filePath = join(process.cwd(), fileUploadPath, name);

  if (existsSync(filePath) === false) {
    throw new Response("Not found", {
      status: 404,
    });
  }

  // Validate file extension against allowed types
  const extension = name.split(".").pop()?.toLowerCase();
  const contentType = getMimeTypeByFilename(name);

  // Reject files with disallowed extensions or MIME types
  if (
    contentType === "application/octet-stream" ||
    !extension ||
    !isAllowedExtension(extension)
  ) {
    throw new Response("File type not allowed", {
      status: 403,
    });
  }

  const headers = assetResponseHeaders(contentType);
  headers.set("Access-Control-Allow-Origin", url.origin);

  return new Response(
    createReadableStreamFromReadable(createReadStream(filePath)),
    { headers }
  );
};
