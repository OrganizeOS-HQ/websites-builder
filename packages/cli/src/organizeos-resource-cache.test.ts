import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { loadResource } from "@webstudio-is/sdk/runtime";
import { createResourceCache } from "../templates/react-router/app/organizeos-resource-cache";

// OrganizeOS fork: the in-memory resource cache published sites' loaders use
// (templates/react-router/app/organizeos-resource-cache.ts).

const url = "https://app.example.org/api/public/v1/forms";
const cacheable = "public, s-maxage=60";
const staleIfError = "public, s-maxage=60, stale-if-error=600";
const authorized = { headers: { Authorization: "Bearer token" } };

type Options = NonNullable<Parameters<typeof createResourceCache>[0]>;

type Reply = {
  body?: string;
  status?: number;
  headers?: Record<string, string>;
};

const reply = ({ body = "body", status = 200, headers = {} }: Reply = {}) =>
  new Response(body, { status, headers });

/** A response whose body fails while it is read. */
const brokenBody = () =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new Error("connection reset"));
      },
    })
  );

/** A cache over a stubbed network and a clock that moves only when told. */
const setup = (options: Omit<Options, "fetch" | "now"> = {}) => {
  let time = 0;
  const network = vi.fn<typeof fetch>();
  const cache = createResourceCache({
    ...options,
    fetch: network,
    now: () => time,
  });
  const wait = (seconds: number) => {
    time += Math.round(seconds * 1000);
  };
  return { cache, network, wait };
};

const get = (cache: typeof fetch, init: RequestInit = {}, at = url) =>
  cache(at, { method: "get", ...init });

const read = async (response: Promise<Response>) => (await response).text();

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("what it stores", () => {
  test("serves a 200 with public, s-maxage=60 without a request until 60 seconds pass, then refetches", async () => {
    const { cache, network, wait } = setup();
    network.mockImplementation(async () =>
      reply({ body: "forms", headers: { "cache-control": cacheable } })
    );

    expect(await read(get(cache))).toBe("forms");
    wait(59.999);
    expect(await read(get(cache))).toBe("forms");
    expect(network).toHaveBeenCalledTimes(1);

    wait(0.001);
    expect(await read(get(cache))).toBe("forms");
    expect(network).toHaveBeenCalledTimes(2);
  });

  test.each<{ name: string; init?: RequestInit; reply: Reply }>([
    {
      name: "a POST",
      init: { method: "post" },
      reply: { headers: { "cache-control": cacheable } },
    },
    {
      name: "a 404",
      reply: { status: 404, headers: { "cache-control": cacheable } },
    },
    {
      name: "a 429",
      reply: { status: 429, headers: { "cache-control": cacheable } },
    },
    {
      name: "no-store",
      reply: { headers: { "cache-control": `${cacheable}, no-store` } },
    },
    {
      name: "private",
      reply: { headers: { "cache-control": "private, s-maxage=60" } },
    },
    {
      name: "no-cache",
      reply: { headers: { "cache-control": `${cacheable}, no-cache` } },
    },
    {
      name: "a no-store after a quoted comma and an escaped quote",
      reply: {
        headers: { "cache-control": `${cacheable}, x="a\\", b", no-store` },
      },
    },
    { name: "no Cache-Control", reply: {} },
    {
      name: "s-maxage=0, which overrides max-age",
      reply: { headers: { "cache-control": "public, s-maxage=0, max-age=60" } },
    },
    {
      name: "Vary: *",
      reply: { headers: { "cache-control": cacheable, vary: "Accept, *" } },
    },
    {
      name: "a Set-Cookie response",
      reply: {
        headers: { "cache-control": cacheable, "set-cookie": "session=1" },
      },
    },
    {
      name: "a max-age-only response to a request with Authorization",
      init: authorized,
      reply: { headers: { "cache-control": "max-age=60" } },
    },
  ])("never caches $name", async ({ init, reply: answer }) => {
    const { cache, network } = setup();
    network.mockImplementation(async () => reply(answer));

    await read(get(cache, init));
    await read(get(cache, init));

    expect(network).toHaveBeenCalledTimes(2);
  });

  test.each([
    { name: "max-age without Authorization", cacheControl: "max-age=60" },
    {
      name: "public with max-age to a request with Authorization",
      init: authorized,
      cacheControl: "public, max-age=60",
    },
    {
      name: "s-maxage to a request with Authorization",
      init: authorized,
      cacheControl: "s-maxage=60",
    },
  ])("caches $name", async ({ init, cacheControl }) => {
    const { cache, network } = setup();
    network.mockImplementation(async () =>
      reply({ headers: { "cache-control": cacheControl } })
    );

    await read(get(cache, init));
    await read(get(cache, init));

    expect(network).toHaveBeenCalledTimes(1);
  });

  test("caps freshness at 300 seconds", async () => {
    const { cache, network, wait } = setup();
    network.mockImplementation(async () =>
      reply({ headers: { "cache-control": "public, s-maxage=3600" } })
    );

    await read(get(cache));
    wait(299.999);
    await read(get(cache));
    expect(network).toHaveBeenCalledTimes(1);

    wait(0.001);
    await read(get(cache));
    expect(network).toHaveBeenCalledTimes(2);
  });

  test("subtracts Age from freshness", async () => {
    const { cache, network, wait } = setup();
    network.mockImplementation(async () =>
      reply({ headers: { "cache-control": cacheable, age: "20" } })
    );

    await read(get(cache));
    wait(39.999);
    await read(get(cache));
    expect(network).toHaveBeenCalledTimes(1);

    wait(0.001);
    await read(get(cache));
    expect(network).toHaveBeenCalledTimes(2);
  });

  test("does not store a response whose Age has used up its freshness", async () => {
    const { cache, network } = setup();
    network.mockImplementation(async () =>
      reply({ headers: { "cache-control": cacheable, age: "60" } })
    );

    await read(get(cache));
    await read(get(cache));

    expect(network).toHaveBeenCalledTimes(2);
  });

  test("a successful refresh replaces the stored body", async () => {
    const { cache, network, wait } = setup();
    network
      .mockResolvedValueOnce(
        reply({ body: "old", headers: { "cache-control": cacheable } })
      )
      .mockResolvedValueOnce(
        reply({ body: "new", headers: { "cache-control": cacheable } })
      );

    expect(await read(get(cache))).toBe("old");
    wait(60);
    expect(await read(get(cache))).toBe("new");
    wait(59);
    expect(await read(get(cache))).toBe("new");
    expect(network).toHaveBeenCalledTimes(2);
  });

  test("returns a body that reads correctly through the sdk's loadResource", async () => {
    const { cache, network } = setup();
    network.mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: [{ id: "form-1" }] }), {
          status: 200,
          statusText: "OK",
          headers: {
            "content-type": "application/json",
            "cache-control": cacheable,
          },
        })
    );
    const request = {
      name: "forms",
      method: "get" as const,
      url,
      searchParams: [],
      headers: [{ name: "Authorization", value: "Bearer token" }],
    };
    const expected = {
      ok: true,
      status: 200,
      statusText: "OK",
      data: { data: [{ id: "form-1" }] },
    };

    expect(await loadResource(cache, request)).toEqual(expected);
    expect(await loadResource(cache, request)).toEqual(expected);
    expect(network).toHaveBeenCalledTimes(1);
  });
});

describe("what it keys on", () => {
  test("requests that differ only in Authorization both reach the network, each for its own body", async () => {
    const { cache, network } = setup();
    network.mockImplementation(async (_input, init) =>
      reply({
        body: `forms for ${new Headers(init?.headers).get("authorization")}`,
        headers: { "cache-control": cacheable },
      })
    );
    const a = { headers: { Authorization: "Bearer a" } };
    const b = { headers: { Authorization: "Bearer b" } };

    expect(await read(get(cache, a))).toBe("forms for Bearer a");
    expect(await read(get(cache, b))).toBe("forms for Bearer b");
    expect(network).toHaveBeenCalledTimes(2);

    expect(await read(get(cache, a))).toBe("forms for Bearer a");
    expect(await read(get(cache, b))).toBe("forms for Bearer b");
    expect(network).toHaveBeenCalledTimes(2);
  });

  test('caches "get", and "GET" shares its key', async () => {
    const { cache, network } = setup();
    network.mockImplementation(async () =>
      reply({ headers: { "cache-control": cacheable } })
    );

    await read(get(cache, { method: "get" }));
    await read(get(cache, { method: "GET" }));
    await read(cache(url));

    expect(network).toHaveBeenCalledTimes(1);
  });

  test("requests that differ only in their query string get separate entries", async () => {
    const { cache, network } = setup();
    network.mockImplementation(async (input) =>
      reply({ body: String(input), headers: { "cache-control": cacheable } })
    );

    expect(await read(get(cache, {}, `${url}?page=1`))).toBe(`${url}?page=1`);
    expect(await read(get(cache, {}, `${url}?page=2`))).toBe(`${url}?page=2`);
    expect(await read(get(cache, {}, `${url}?page=1`))).toBe(`${url}?page=1`);

    expect(network).toHaveBeenCalledTimes(2);
  });

  test("a request with its own Cache-Control bypasses the cache", async () => {
    const { cache, network } = setup();
    network.mockImplementation(async () =>
      reply({ headers: { "cache-control": cacheable } })
    );
    const optIn = { headers: { "Cache-Control": "max-age=60" } };

    await read(get(cache));
    // Each reaches the network, though the same request just got a
    // cacheable response.
    await read(get(cache, optIn));
    await read(get(cache, optIn));

    expect(network).toHaveBeenCalledTimes(3);
  });

  test("hands the underlying fetch the URL and init it would have had without the cache", async () => {
    const { cache, network } = setup();
    network.mockImplementation(async () =>
      reply({ headers: { "cache-control": cacheable } })
    );
    const requests: Array<[string, RequestInit]> = [
      [
        url,
        {
          method: "get",
          headers: { Authorization: "Bearer Token-ABC", "X-Site": "Acme" },
        },
      ],
      [
        `${url}?page=2`,
        { method: "get", headers: new Headers({ Authorization: "Bearer b" }) },
      ],
      [url, { method: "post", body: "{}", headers: authorized.headers }],
      [url, { method: "get", headers: { "Cache-Control": "max-age=60" } }],
    ];

    for (const [input, init] of requests) {
      await read(cache(input, init));
    }

    expect(network.mock.calls).toHaveLength(requests.length);
    requests.forEach(([input, init], index) => {
      expect(network.mock.calls[index][0]).toBe(input);
      expect(network.mock.calls[index][1]).toBe(init);
    });
    expect(requests[0][1]).toEqual({
      method: "get",
      headers: { Authorization: "Bearer Token-ABC", "X-Site": "Acme" },
    });
  });
});

describe("one request per key", () => {
  test("ten concurrent requests make one network request, each with its own readable body", async () => {
    const { cache, network } = setup();
    const response = Promise.withResolvers<Response>();
    network.mockReturnValue(response.promise);

    const requests = Array.from({ length: 10 }, () => get(cache));
    response.resolve(
      reply({ body: "forms", headers: { "cache-control": cacheable } })
    );
    const responses = await Promise.all(requests);

    expect(network).toHaveBeenCalledTimes(1);
    expect(new Set(responses).size).toBe(10);
    expect(await Promise.all(responses.map((each) => each.text()))).toEqual(
      Array(10).fill("forms")
    );
  });

  test("ten concurrent requests share one non-cacheable result too, which is not stored", async () => {
    const { cache, network } = setup();
    const response = Promise.withResolvers<Response>();
    network.mockReturnValueOnce(response.promise);

    const requests = Array.from({ length: 10 }, () => get(cache));
    response.resolve(reply({ body: "missing", status: 404 }));
    const responses = await Promise.all(requests);

    expect(network).toHaveBeenCalledTimes(1);
    expect(responses.map((each) => each.status)).toEqual(Array(10).fill(404));
    expect(await Promise.all(responses.map((each) => each.text()))).toEqual(
      Array(10).fill("missing")
    );

    network.mockResolvedValueOnce(reply({ body: "found" }));
    expect(await read(get(cache))).toBe("found");
    expect(network).toHaveBeenCalledTimes(2);
  });

  test("concurrent requests for a stale entry wait on one refresh", async () => {
    const { cache, network, wait } = setup();
    network.mockResolvedValueOnce(
      reply({ body: "old", headers: { "cache-control": cacheable } })
    );
    await read(get(cache));
    wait(60);
    const response = Promise.withResolvers<Response>();
    network.mockReturnValueOnce(response.promise);

    const requests = Array.from({ length: 5 }, () => read(get(cache)));
    response.resolve(
      reply({ body: "new", headers: { "cache-control": cacheable } })
    );

    expect(await Promise.all(requests)).toEqual(Array(5).fill("new"));
    expect(network).toHaveBeenCalledTimes(2);
  });

  test("after a thrown fetch, the next request reaches the network again", async () => {
    const { cache, network } = setup();
    network.mockRejectedValueOnce(new TypeError("fetch failed"));
    network.mockResolvedValueOnce(reply({ body: "forms" }));

    await expect(get(cache)).rejects.toThrow("fetch failed");
    expect(await read(get(cache))).toBe("forms");
    expect(network).toHaveBeenCalledTimes(2);
  });

  test("after a body read that rejects, the next request reaches the network again", async () => {
    const { cache, network } = setup();
    network.mockResolvedValueOnce(brokenBody());
    network.mockResolvedValueOnce(reply({ body: "forms" }));

    await expect(get(cache)).rejects.toThrow("connection reset");
    expect(await read(get(cache))).toBe("forms");
    expect(network).toHaveBeenCalledTimes(2);
  });

  test("after a 500, the next request reaches the network again", async () => {
    const { cache, network } = setup();
    network.mockResolvedValueOnce(reply({ body: "broken", status: 500 }));
    network.mockResolvedValueOnce(reply({ body: "forms" }));

    const failed = await get(cache);
    expect(failed.status).toBe(500);
    expect(await failed.text()).toBe("broken");
    expect(await read(get(cache))).toBe("forms");
    expect(network).toHaveBeenCalledTimes(2);
  });

  test("a failed refresh still serves the stale entry another key evicted while it ran", async () => {
    const { cache, network, wait } = setup({ maxEntries: 1 });
    const other = "https://app.example.org/api/public/v1/events";
    network.mockResolvedValueOnce(
      reply({ body: "stored", headers: { "cache-control": staleIfError } })
    );
    await read(get(cache));
    wait(60);
    const refresh = Promise.withResolvers<Response>();
    network.mockReturnValueOnce(refresh.promise);
    network.mockResolvedValueOnce(
      reply({ body: "events", headers: { "cache-control": cacheable } })
    );

    const stale = read(get(cache));
    expect(await read(get(cache, {}, other))).toBe("events");
    refresh.resolve(reply({ status: 503 }));

    expect(await stale).toBe("stored");
    expect(network).toHaveBeenCalledTimes(3);
  });
});

describe("stale-if-error", () => {
  // RFC 5861's four, and 429.
  const failedStatuses = [429, 500, 502, 503, 504];
  const failures = [
    ...failedStatuses.map((status) => ({
      name: `a ${status}`,
      fail: async () => reply({ status }),
    })),
    {
      name: "a thrown fetch",
      fail: async (): Promise<Response> => {
        throw new TypeError("fetch failed");
      },
    },
    { name: "a body read that rejects", fail: async () => brokenBody() },
  ];

  /** A cache holding "stored" with stale-if-error=600, gone stale at 60. */
  const setupStored = async (cacheControl = staleIfError) => {
    const context = setup();
    context.network.mockResolvedValueOnce(
      reply({ body: "stored", headers: { "cache-control": cacheControl } })
    );
    await read(get(context.cache));
    return context;
  };

  test.each(failures)(
    "serves the stale entry on $name within the window",
    async ({ fail }) => {
      const { cache, network, wait } = await setupStored();
      wait(60 + 599.999);
      network.mockImplementationOnce(fail);

      expect(await read(get(cache))).toBe("stored");
      expect(network).toHaveBeenCalledTimes(2);
    }
  );

  test.each(failedStatuses)(
    "passes a %i through once the window has passed",
    async (status) => {
      const { cache, network, wait } = await setupStored();
      wait(60 + 600);
      network.mockResolvedValueOnce(reply({ body: "failed", status }));

      const response = await get(cache);
      expect(response.status).toBe(status);
      expect(await response.text()).toBe("failed");
    }
  );

  test("passes a thrown fetch through once the window has passed", async () => {
    const { cache, network, wait } = await setupStored();
    wait(60 + 600);
    network.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(get(cache)).rejects.toThrow("fetch failed");
  });

  test("passes a failure through when the stored response had no stale-if-error", async () => {
    const { cache, network, wait } = await setupStored(cacheable);
    wait(61);
    network.mockResolvedValueOnce(reply({ body: "unavailable", status: 503 }));

    const response = await get(cache);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("unavailable");
  });

  test.each([401, 403, 404])(
    "never answers a %i with the stale entry, then or after a later failure",
    async (status) => {
      const { cache, network, wait } = await setupStored();
      wait(61);
      network.mockResolvedValueOnce(reply({ body: "gone", status }));
      network.mockResolvedValueOnce(reply({ body: "down", status: 503 }));

      const response = await get(cache);
      expect(response.status).toBe(status);
      expect(await response.text()).toBe("gone");
      expect(await read(get(cache))).toBe("down");
    }
  );

  test("caps stale-if-error at 3600 seconds", async () => {
    const { cache, network, wait } = await setupStored(
      "public, s-maxage=60, stale-if-error=86400"
    );
    network.mockImplementation(async () => reply({ status: 503 }));

    wait(60 + 3599.999);
    expect(await read(get(cache))).toBe("stored");
    wait(0.001);
    expect((await get(cache)).status).toBe(503);
  });

  test("logs one line naming the failure and the URL's origin and path only", async () => {
    const { cache, network, wait } = setup();
    const secret = `${url}?org=secret-org`;
    network.mockResolvedValueOnce(
      reply({ body: "forms-body", headers: { "cache-control": staleIfError } })
    );
    await read(get(cache, authorized, secret));
    expect(warn).not.toHaveBeenCalled();

    wait(61);
    network.mockResolvedValueOnce(reply({ status: 429 }));
    expect(await read(get(cache, authorized, secret))).toBe("forms-body");
    // Served from the backoff: no second line.
    wait(1);
    await read(get(cache, authorized, secret));

    expect(warn).toHaveBeenCalledTimes(1);
    const [line] = warn.mock.calls[0];
    expect(line).toContain(`${url} failed (status 429)`);
    expect(line).not.toContain("secret-org");
    expect(line).not.toContain("Bearer");
    expect(line).not.toContain("forms-body");

    wait(10);
    network.mockRejectedValueOnce(new TypeError("fetch failed"));
    await read(get(cache, authorized, secret));
    expect(warn).toHaveBeenLastCalledWith(
      expect.stringContaining(`${url} failed (network error)`)
    );
  });
});

describe("backoff after a failed refresh", () => {
  test.each([
    {
      name: "a 429's Retry-After: 30",
      fail: () => reply({ status: 429, headers: { "retry-after": "30" } }),
      seconds: 30,
    },
    {
      name: "a 503's Retry-After: 30",
      fail: () => reply({ status: 503, headers: { "retry-after": "30" } }),
      seconds: 30,
    },
    {
      name: "the fixed 10 seconds without Retry-After",
      fail: () => reply({ status: 429 }),
      seconds: 10,
    },
    {
      name: "the fixed 10 seconds for a 500, whatever its Retry-After",
      fail: () => reply({ status: 500, headers: { "retry-after": "30" } }),
      seconds: 10,
    },
    {
      name: "60 seconds for a Retry-After above 60",
      fail: () => reply({ status: 429, headers: { "retry-after": "120" } }),
      seconds: 60,
    },
  ])("waits $name before the next refresh", async ({ fail, seconds }) => {
    const { cache, network, wait } = setup();
    network.mockResolvedValueOnce(
      reply({ body: "stored", headers: { "cache-control": staleIfError } })
    );
    await read(get(cache));
    wait(61);
    network.mockResolvedValueOnce(fail());

    expect(await read(get(cache))).toBe("stored");
    wait(1);
    expect(await read(get(cache))).toBe("stored");
    wait(seconds - 1.001);
    expect(await read(get(cache))).toBe("stored");
    expect(network).toHaveBeenCalledTimes(2);

    wait(0.001);
    network.mockResolvedValueOnce(
      reply({ body: "fresh", headers: { "cache-control": staleIfError } })
    );
    expect(await read(get(cache))).toBe("fresh");
    expect(network).toHaveBeenCalledTimes(3);
  });

  test("ends with the stale-if-error window", async () => {
    const { cache, network, wait } = setup();
    network.mockResolvedValueOnce(
      reply({
        body: "stored",
        headers: { "cache-control": "public, s-maxage=60, stale-if-error=20" },
      })
    );
    await read(get(cache));
    wait(61);
    network.mockResolvedValueOnce(
      reply({ status: 429, headers: { "retry-after": "60" } })
    );
    expect(await read(get(cache))).toBe("stored");

    wait(18.999);
    expect(await read(get(cache))).toBe("stored");
    expect(network).toHaveBeenCalledTimes(2);

    wait(0.001);
    network.mockResolvedValueOnce(reply({ body: "limited", status: 429 }));
    expect(await read(get(cache))).toBe("limited");
    expect(network).toHaveBeenCalledTimes(3);
  });
});

describe("bounds", () => {
  const at = (cache: typeof fetch, path: string) =>
    read(get(cache, {}, `https://api.example.org/${path}`));

  const answerWithPath = (network: ReturnType<typeof setup>["network"]) =>
    network.mockImplementation(async (input) =>
      reply({
        body: String(input).slice(-4),
        headers: { "cache-control": cacheable },
      })
    );

  test("evicts the least recently used entry past maxEntries", async () => {
    const { cache, network } = setup({ maxEntries: 2 });
    answerWithPath(network);

    await at(cache, "aaaa");
    await at(cache, "bbbb");
    await at(cache, "aaaa");
    await at(cache, "cccc");
    expect(network).toHaveBeenCalledTimes(3);

    await at(cache, "aaaa");
    await at(cache, "cccc");
    expect(network).toHaveBeenCalledTimes(3);
    await at(cache, "bbbb");
    expect(network).toHaveBeenCalledTimes(4);
  });

  test("evicts the least recently used entry past maxBytes", async () => {
    const { cache, network } = setup({ maxBytes: 10 });
    answerWithPath(network);

    await at(cache, "aaaa");
    await at(cache, "bbbb");
    await at(cache, "aaaa");
    await at(cache, "cccc");
    expect(network).toHaveBeenCalledTimes(3);

    await at(cache, "aaaa");
    await at(cache, "cccc");
    expect(network).toHaveBeenCalledTimes(3);
    await at(cache, "bbbb");
    expect(network).toHaveBeenCalledTimes(4);
  });

  test("never stores a body over maxEntryBytes", async () => {
    const { cache, network } = setup({ maxEntryBytes: 4 });
    network.mockImplementation(async (input) =>
      reply({
        body: String(input).endsWith("large") ? "12345" : "1234",
        headers: { "cache-control": cacheable },
      })
    );

    await at(cache, "large");
    await at(cache, "large");
    expect(network).toHaveBeenCalledTimes(2);

    await at(cache, "small");
    await at(cache, "small");
    expect(network).toHaveBeenCalledTimes(3);
  });

  test("counts sizes in UTF-8 bytes", async () => {
    const { cache, network } = setup({ maxEntryBytes: 5, maxBytes: 7 });
    network.mockImplementation(async (input) =>
      reply({
        // three characters in six bytes; two in four
        body: String(input).endsWith("large") ? "ééé" : "éé",
        headers: { "cache-control": cacheable },
      })
    );

    await at(cache, "large");
    await at(cache, "large");
    expect(network).toHaveBeenCalledTimes(2);

    // Four bytes each: the second evicts the first, as 8 > 7.
    await at(cache, "one");
    await at(cache, "two");
    await at(cache, "two");
    expect(network).toHaveBeenCalledTimes(4);
    await at(cache, "one");
    expect(network).toHaveBeenCalledTimes(5);
  });
});

test("logs nothing on the hot path", async () => {
  const { cache, network, wait } = setup();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  network.mockImplementation(async () =>
    reply({ headers: { "cache-control": staleIfError } })
  );

  await read(get(cache));
  await read(get(cache));
  wait(61);
  await read(get(cache));

  expect(log).not.toHaveBeenCalled();
  expect(info).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
});
