import { useEffect, useState } from "react";
import { Alert } from "./alert";
import { useWindowResizeDebounced } from "~/shared/dom-hooks";
import { $isPreviewMode } from "~/shared/nano-states";
import { useStore } from "@nanostores/react";
import { $loadingState } from "~/builder/shared/nano-states";
import { productName } from "~/shared/branding";

/**
 * OrganizeOS fork: upstream put a second, dismissable interstitial here — a
 * full-screen "the builder supports Chromium-based browsers such as Chrome,
 * Edge, Brave, Arc... we plan to support Firefox and Safari in the near future"
 * notice, gated on `"chrome" in window`. It is removed:
 *
 *  - it carries an upstream product roadmap OrganizeOS has not committed to;
 *  - it links four browser vendors' marketing pages out of an embedded surface;
 *  - an org admin reaches this builder by clicking through from their own
 *    workspace, so a full-screen vendor notice reads as a broken product.
 *
 * Removing it also retires the dismiss mechanism, which had a real defect: the
 * dismissed flag was a module-level atom shared with the alert below, so
 * dismissing the browser notice permanently suppressed the window-size alert
 * for the rest of the session.
 *
 * The window-size alert stays. It is actionable — it tells the user something
 * they can fix — and it is the only blocking alert left.
 */

const useTooSmallMessage = () => {
  const [message, setMessage] = useState<string>();
  const check = () => {
    // To have more space for Chrome DevTools, we allow a smaller window size in development
    const minWidth = process.env.NODE_ENV === "production" ? 900 : 700;
    const message =
      window.innerWidth >= minWidth
        ? undefined
        : `Your browser window is too small. Resize your browser to at least ${minWidth}px wide to continue building with ${productName}.`;
    setMessage(message);
  };

  useWindowResizeDebounced(check);
  useEffect(check, []);
  return message;
};

export const BlockingAlerts = () => {
  const isPreviewMode = useStore($isPreviewMode);
  const loadingState = useStore($loadingState);

  const message = useTooSmallMessage();

  if (
    message === undefined ||
    // Preview mode is for looking at the site, not building it, so a
    // resize-your-window block would be wrong there.
    isPreviewMode ||
    loadingState.state !== "ready"
  ) {
    return;
  }

  return <Alert message={message} />;
};
