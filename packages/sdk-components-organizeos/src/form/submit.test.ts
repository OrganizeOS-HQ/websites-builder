import { afterEach, expect, test, vi } from "vitest";
import {
  postToPlatform,
  stateForAnswer,
  type AnswerStates,
  type PlatformAnswer,
} from "./submit";

afterEach(() => {
  vi.unstubAllGlobals();
});

const states: AnswerStates<"done" | "pending" | "failed"> = {
  outcomes: { finished: "done", queued: "pending" },
  success: "done",
  error: "failed",
};

test("known outcomes map to their states, unknown ones to the success state", () => {
  expect(stateForAnswer({ outcome: "queued" }, states)).toEqual({
    state: "pending",
  });
  expect(stateForAnswer({ outcome: "finished" }, states)).toEqual({
    state: "done",
  });
  expect(stateForAnswer({ outcome: "added_later" }, states)).toEqual({
    state: "done",
  });
  // never a key of Object.prototype
  expect(stateForAnswer({ outcome: "constructor" }, states)).toEqual({
    state: "done",
  });
});

test("every error maps to the error state; invalid_field names its field", () => {
  expect(
    stateForAnswer({ error: "invalid_field", field: "email" }, states)
  ).toEqual({ state: "failed", field: "email" });
  expect(stateForAnswer({ error: "rate_limited" }, states)).toEqual({
    state: "failed",
  });
  expect(stateForAnswer({ error: "added_later", field: "x" }, states)).toEqual({
    state: "failed",
  });
});

test.each(["canvas", "preview"] as const)(
  "never posts on the %s",
  async (renderer) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await postToPlatform({ renderer, path: "/api/x", body: {} })
    ).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  }
);

test("posts JSON to a same-origin path and reads the answer", async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({ outcome: "subscribed" }, { status: 200 })
  );
  vi.stubGlobal("fetch", fetchMock);
  expect(
    await postToPlatform({
      renderer: undefined,
      path: "/api/x",
      body: { a: 1 },
    })
  ).toEqual({ outcome: "subscribed" });
  expect(fetchMock).toHaveBeenCalledWith("/api/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"a":1}',
    credentials: "same-origin",
  });
});

test("refuses any path that is not on the page's own origin", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  for (const path of ["https://evil.example/x", "//evil.example/x", "api/x"]) {
    expect(
      await postToPlatform({ renderer: undefined, path, body: {} })
    ).toEqual({ error: "invalid_path" });
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

test("answers it cannot read, and network failures, are errors", async () => {
  const answers: Array<[() => Promise<Response>, PlatformAnswer]> = [
    [
      async () => Response.json({ error: "not_found" }, { status: 404 }),
      { error: "not_found" },
    ],
    [
      async () =>
        Response.json(
          { error: "invalid_field", field: "email" },
          { status: 422 }
        ),
      { error: "invalid_field", field: "email" },
    ],
    // an outcome on a failed response is not a success
    [
      async () => Response.json({ outcome: "subscribed" }, { status: 500 }),
      { error: "unreadable_answer" },
    ],
    [
      async () => new Response("<html></html>", { status: 200 }),
      { error: "unreadable_answer" },
    ],
    [
      async () => Response.json(["subscribed"], { status: 200 }),
      { error: "unreadable_answer" },
    ],
    [
      async () => {
        throw new TypeError("Failed to fetch");
      },
      { error: "network" },
    ],
  ];
  for (const [respond, expected] of answers) {
    vi.stubGlobal("fetch", vi.fn(respond));
    expect(
      await postToPlatform({ renderer: undefined, path: "/api/x", body: {} })
    ).toEqual(expected);
  }
});
