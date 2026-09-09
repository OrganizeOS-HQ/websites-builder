import { describe, expect, test } from "vitest";
import {
  getOrganizeosPublishState,
  ORGANIZEOS_PUBLISH_TIMEOUT_MS,
} from "./organizeos-publish-status";

const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const minutesAgo = (minutes: number) =>
  new Date(NOW - minutes * 60 * 1000).toISOString();

describe("getOrganizeosPublishState", () => {
  test("a project that was never published is idle", () => {
    expect(getOrganizeosPublishState(null, NOW)).toEqual({ status: "idle" });
    expect(getOrganizeosPublishState(undefined, NOW)).toEqual({
      status: "idle",
    });
  });

  test("a published build reports when it went live", () => {
    expect(
      getOrganizeosPublishState(
        { createdAt: minutesAgo(5), publishStatus: "PUBLISHED" },
        NOW
      )
    ).toEqual({ status: "published", at: new Date(minutesAgo(5)) });
  });

  test("a build the executor reported as failed is failed, not timed out", () => {
    expect(
      getOrganizeosPublishState(
        { createdAt: minutesAgo(1), publishStatus: "FAILED" },
        NOW
      )
    ).toEqual({
      status: "failed",
      at: new Date(minutesAgo(1)),
      timedOut: false,
    });
  });

  test("a pending build stays pending for the whole executor window", () => {
    // Well past upstream's three-minute assumption, still inside ours.
    expect(
      getOrganizeosPublishState(
        { createdAt: minutesAgo(10), publishStatus: "PENDING" },
        NOW
      )
    ).toEqual({ status: "pending", at: new Date(minutesAgo(10)) });
  });

  test("a pending build older than the executor timeout is presumed failed", () => {
    const createdAt = new Date(
      NOW - ORGANIZEOS_PUBLISH_TIMEOUT_MS - 1000
    ).toISOString();
    expect(
      getOrganizeosPublishState({ createdAt, publishStatus: "PENDING" }, NOW)
    ).toEqual({ status: "failed", at: new Date(createdAt), timedOut: true });
  });
});
