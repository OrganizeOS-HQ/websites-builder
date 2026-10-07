// Our root outlet doesn't contain a layout because we have 2 types of documents: canvas and builder and we need to decide down the line which one to render, thre is no single root document.
import {
  Outlet,
  json,
  useLoaderData,
  type ShouldRevalidateFunction,
} from "@remix-run/react";
import type { HeadersFunction } from "@remix-run/server-runtime";
import { setEnv } from "@webstudio-is/feature-flags";
import env from "./env/env.server";
import { frameProtectionHeaders } from "./shared/frame-protection";
import { useSetFeatures } from "./shared/use-set-features";

export const loader = () => {
  return json({
    featureFlags: env.FEATURE_FLAGS,
  });
};

// No other page may frame the builder or the canvas. A route without its own
// `headers` export inherits this; one with an export replaces it and has to
// merge it back in (see shared/frame-protection.ts).
export const headers: HeadersFunction = () => frameProtectionHeaders;

export default function App() {
  const { featureFlags } = useLoaderData<typeof loader>();
  setEnv(featureFlags);
  useSetFeatures();

  return <Outlet />;
}

export const shouldRevalidate: ShouldRevalidateFunction = () => {
  return false;
};
