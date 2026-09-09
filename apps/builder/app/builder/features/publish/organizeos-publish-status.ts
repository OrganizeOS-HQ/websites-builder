/**
 * Publish state for an OrganizeOS site, derived from the project's latest
 * production build the same way upstream's getPublishStatusAndText does, but
 * with a window that matches our executor. Upstream assumes a build that is
 * still PENDING after three minutes has failed, because its cloud publisher
 * answers in seconds. Ours is a GitHub Actions run (install, build the site
 * with the CLI, deploy to Vercel, flip the pointer) with a 25 minute job
 * timeout, so a build is only presumed dead after that.
 */

/** Mirrors `timeout-minutes` in .github/workflows/publish-site.yml. */
export const ORGANIZEOS_PUBLISH_TIMEOUT_MS = 25 * 60 * 1000;

export type LatestBuildLike = {
  createdAt: string;
  publishStatus: "PENDING" | "FAILED" | "PUBLISHED";
};

export type OrganizeosPublishState =
  | { status: "idle" }
  | { status: "pending"; at: Date }
  | { status: "published"; at: Date }
  | { status: "failed"; at: Date; timedOut: boolean };

export const getOrganizeosPublishState = (
  build: LatestBuildLike | null | undefined,
  now: number = Date.now()
): OrganizeosPublishState => {
  if (build == null) {
    return { status: "idle" };
  }
  const at = new Date(build.createdAt);
  if (build.publishStatus === "PUBLISHED") {
    return { status: "published", at };
  }
  if (build.publishStatus === "FAILED") {
    return { status: "failed", at, timedOut: false };
  }
  if (now - at.getTime() > ORGANIZEOS_PUBLISH_TIMEOUT_MS) {
    return { status: "failed", at, timedOut: true };
  }
  return { status: "pending", at };
};
