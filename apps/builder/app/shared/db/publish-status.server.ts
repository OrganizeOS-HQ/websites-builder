/**
 * Publish status write-back (Websites 2.0 Phase 5).
 *
 * Upstream Webstudio's cloud publisher flips `Build.publishStatus` from
 * PENDING to PUBLISHED or FAILED when a deployment finishes, and every status
 * the builder shows (the Publish dialog, "Published x ago", the pending
 * spinner) reads that column. Our executor is a GitHub Actions workflow, so
 * nothing flipped the column: every publish looked pending, then "failed" once
 * the UI's timeout elapsed, whatever actually happened. The workflow now
 * reports back through the internal publish-status route, and the publisher
 * marks a build FAILED itself when the dispatch never leaves the builder.
 */

export const buildPublishStatuses = ["PUBLISHED", "FAILED"] as const;

export type BuildPublishStatus = (typeof buildPublishStatuses)[number];

/**
 * The slice of the PostgREST client the write-back needs. Structural so the
 * publisher (which already narrows the client) and the route can share it.
 */
export type BuildStatusClient = {
  from: (table: "Build") => {
    update: (values: { publishStatus: BuildPublishStatus }) => {
      eq: (
        column: "id",
        value: string
      ) => {
        not: (
          column: "deployment",
          operator: "is",
          value: null
        ) => {
          select: (columns: "id") => PromiseLike<{
            data: Array<{ id: string }> | null;
            error: unknown;
          }>;
        };
      };
    };
  };
};

/**
 * Record the outcome of a production build's publish. Scoped to builds that
 * carry a deployment: the project's live dev build never has one, so a stray
 * id can never mark it. Resolves true when a build was updated, false when no
 * such production build exists; throws on a store error.
 */
export const markBuildPublishStatus = async (
  client: BuildStatusClient,
  { buildId, status }: { buildId: string; status: BuildPublishStatus }
): Promise<boolean> => {
  const result = await client
    .from("Build")
    .update({ publishStatus: status })
    .eq("id", buildId)
    .not("deployment", "is", null)
    .select("id");

  if (result.error) {
    throw result.error;
  }
  return (result.data ?? []).length > 0;
};
