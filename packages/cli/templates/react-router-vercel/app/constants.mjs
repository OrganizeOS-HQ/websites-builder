/**
 * We use mjs extension as constants in this file is shared with the build script
 * and we use `node --eval` to extract the constants.
 */
export const assetBaseUrl = "/assets/";

/**
 * @type {import("@webstudio-is/image").ImageLoader}
 */
export const imageLoader = (props) => {
  // OrganizeOS fork: always the original file. A published site is served on
  // the org's host through the OrganizeOS proxy, and Vercel answers
  // /_vercel/image on that host with the OrganizeOS app's own optimizer. Its
  // allowed widths and qualities are not ours, and it cannot fetch this
  // deployment's /assets/*, so every optimized URL fails there
  // (INVALID_IMAGE_OPTIMIZE_REQUEST). Upstream builds
  // `/_vercel/image?url=&w=&q=` here outside dev and raw.
  return props.src;
};
