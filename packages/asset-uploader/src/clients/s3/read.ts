import type { SignatureV4 } from "@smithy/signature-v4";
import { getS3ObjectUrl } from "./object-url";

/**
 * Fetches an uploaded file with a signed GET, so the bucket can stay private.
 *
 * Resolves to undefined when storage has no such object and throws on any
 * other storage error, so a caller never forwards the provider's error body.
 * A 206 or 416 answer to `range` is returned as is.
 */
export const readFromS3 = async ({
  signer,
  name,
  endpoint,
  bucket,
  range,
}: {
  signer: SignatureV4;
  name: string;
  endpoint: string;
  bucket: string;
  range?: string;
}): Promise<Response | undefined> => {
  const url = getS3ObjectUrl({ endpoint, bucket, name });

  const s3Request = await signer.sign({
    method: "GET",
    protocol: url.protocol,
    hostname: url.hostname,
    path: url.pathname,
    headers: {
      // signed like the AWS SDKs do; fetch derives the same value from the URL
      host: url.host,
      ...(range === undefined ? {} : { range }),
    },
  });

  const headers = new Headers(s3Request.headers);
  headers.delete("host");
  // left unsigned: proxies in front of storage may rewrite it
  headers.set("accept-encoding", "identity");

  const response = await fetch(url, { method: "GET", headers });

  if (response.status === 404) {
    await response.body?.cancel();
    return;
  }
  if (response.ok === false && response.status !== 416) {
    await response.body?.cancel();
    throw Error(
      `Cannot read file ${name}: storage responded ${response.status}`
    );
  }
  return response;
};
