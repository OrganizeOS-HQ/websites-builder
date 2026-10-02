/**
 * Opens the page a root goes to after a successful submission. Only http(s)
 * targets: the page link comes from the builder's URL control, and a
 * `javascript:` value must never run. Returns whether it navigated.
 */
export const navigateTo = (href: string): boolean => {
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
  window.location.assign(url.href);
  return true;
};
