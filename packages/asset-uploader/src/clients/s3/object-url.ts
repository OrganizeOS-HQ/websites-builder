import { extendedEncodeURIComponent } from "../../utils/sanitize-s3-key";

/**
 * Path-style URL of an object, `<endpoint>/<bucket>/<key>`.
 *
 * The endpoint keeps its own path, which resolving `/<bucket>/<key>` against
 * it would drop: Supabase Storage serves its S3 API under /storage/v1/s3.
 */
export const getS3ObjectUrl = ({
  endpoint,
  bucket,
  name,
}: {
  endpoint: string;
  bucket: string;
  name: string;
}): URL => {
  // "." and ".." are not encoded and would be resolved away, turning an
  // object request into one for the bucket (a listing) or the service.
  if (name === "" || name === "." || name === "..") {
    throw new Error(`Invalid object name "${name}"`);
  }
  const url = new URL(endpoint);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/${bucket}/${extendedEncodeURIComponent(name)}`;
  url.search = "";
  url.hash = "";
  return url;
};
