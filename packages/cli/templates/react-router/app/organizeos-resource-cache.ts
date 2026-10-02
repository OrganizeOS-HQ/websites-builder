/**
 * OrganizeOS fork: an in-memory cache for the resource GETs a published page's
 * loader makes. A page renders on every request (no-store), and each render
 * fetches every resource the page reaches, :root ones included. On Vercel
 * nothing else caches those fetches: the CDN skips a request that carries
 * Authorization, and the sdk's cachedFetch needs a Cache API the runtime lacks.
 *
 * One function instance serves many visitors, so this is a shared cache under
 * RFC 9111, and it stores only what a response declares storable:
 *
 * - Requests: a GET with no body and no Cache-Control of its own (that is the
 *   opt-in for cachedFetch, left to it). Anything else goes straight through.
 * - Key: the method, the URL and every request header, so requests that differ
 *   in any header, Authorization included, never share an entry.
 * - Stored: a 200 with s-maxage or max-age above 0, without no-store, private,
 *   no-cache, Vary: * or Set-Cookie, and, for a request with Authorization,
 *   with public or s-maxage (section 3.5). Fresh for s-maxage, else max-age,
 *   less Age (section 4.2.3), at most 300 seconds.
 *
 * A stale entry is refreshed by the request that finds it, once for all who
 * wait. A refresh that fails (a network error, or a 429, 500, 502, 503 or 504)
 * is answered with the stale entry for up to stale-if-error seconds past its
 * freshness, and the next refresh waits Retry-After or 10 seconds. RFC 5861
 * names 500, 502, 503 and 504: treating 429 as a failure is this cache's
 * extension, right for /v1, where OrganizeOS owns both ends.
 *
 * It ships raw into every generated site, so it imports nothing.
 */

type ResourceCacheOptions = {
  /** The fetch behind the cache. Default: the global fetch, looked up per call. */
  fetch?: typeof fetch;
  /** The clock, in milliseconds. */
  now?: () => number;
  maxEntries?: number;
  /** Across all entries' bodies, in UTF-8 bytes. */
  maxBytes?: number;
  /** A larger body is not stored. */
  maxEntryBytes?: number;
};

/** A response as it is shared and stored. The sdk reads only the body text. */
type Snapshot = {
  status: number;
  statusText: string;
  contentType: string | null;
  body: string;
};

type Entry = {
  snapshot: Snapshot;
  /** The body's size in UTF-8 bytes. */
  bytes: number;
  /** Served without a request before this time. */
  freshUntil: number;
  /** May answer a failed refresh before this time (stale-if-error). */
  staleUntil: number;
  /** After a failed refresh, no other refresh before this time. */
  retryAt: number;
};

const MAX_FRESH_SECONDS = 300;
const MAX_STALE_IF_ERROR_SECONDS = 3600;
const MAX_RETRY_AFTER_SECONDS = 60;
const DEFAULT_RETRY_SECONDS = 10;

// RFC 5861's four, and 429 (see above).
const FAILED_REFRESH_STATUSES = new Set([429, 500, 502, 503, 504]);

// A Response with one of these statuses cannot carry a body.
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

const encoder = new TextEncoder();

/**
 * Splits a comma-separated header value, keeping commas in quoted strings, so
 * a quoted value can never hide a directive such as no-store.
 */
const splitList = (value: string) => {
  const items: string[] = [];
  let item = "";
  let quoted = false;
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      escaped = false;
    } else if (quoted && char === "\\") {
      escaped = true;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && quoted === false) {
      items.push(item.trim());
      item = "";
      continue;
    }
    item += char;
  }
  items.push(item.trim());
  return items;
};

/** Cache-Control directives by lower-cased name: the first of each, unquoted. */
const parseDirectives = (header: string | null) => {
  const directives = new Map<string, string>();
  for (const item of splitList(header ?? "")) {
    const [name, ...rest] = item.split("=");
    const key = name.trim().toLowerCase();
    const value = rest
      .join("=")
      .trim()
      .replace(/^"(.*)"$/, "$1");
    if (key !== "" && directives.has(key) === false) {
      directives.set(key, value);
    }
  }
  return directives;
};

/** A delta-seconds value (RFC 9111 section 1.2.2), or undefined. */
const parseSeconds = (value: string | null | undefined) =>
  value != null && /^\d+$/.test(value) ? Number(value) : undefined;

/**
 * How many seconds after its request a response stays fresh, or undefined
 * when it may not be stored (RFC 9111 sections 3, 3.5 and 4.2).
 */
const getFreshSeconds = (
  response: Response,
  directives: Map<string, string>,
  hasAuthorization: boolean
) => {
  if (
    response.status !== 200 ||
    directives.has("no-store") ||
    directives.has("private") ||
    directives.has("no-cache") ||
    splitList(response.headers.get("vary") ?? "").includes("*") ||
    response.headers.has("set-cookie") ||
    (hasAuthorization &&
      directives.has("public") === false &&
      directives.has("s-maxage") === false)
  ) {
    return;
  }
  // s-maxage overrides max-age in a shared cache; an invalid value is stale.
  const lifetime = directives.has("s-maxage")
    ? parseSeconds(directives.get("s-maxage"))
    : parseSeconds(directives.get("max-age"));
  const age = parseSeconds(response.headers.get("age")) ?? 0;
  if (lifetime === undefined || lifetime - age <= 0) {
    return;
  }
  return Math.min(lifetime - age, MAX_FRESH_SECONDS);
};

/** Each caller gets its own Response, so a body is never read twice. */
const toResponse = ({ status, statusText, contentType, body }: Snapshot) =>
  new Response(NULL_BODY_STATUSES.has(status) ? null : body, {
    status,
    statusText,
    headers: contentType === null ? undefined : { "content-type": contentType },
  });

/** A URL's origin and path for a log line, never its query. */
const describeUrl = (url: string) => {
  try {
    const { origin, pathname } = new URL(url);
    return `${origin}${pathname}`;
  } catch {
    return "a resource";
  }
};

export const createResourceCache = (
  options: ResourceCacheOptions = {}
): typeof fetch => {
  const underlyingFetch: typeof fetch =
    options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? 200;
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  const maxEntryBytes = Math.min(
    options.maxEntryBytes ?? 1024 * 1024,
    maxBytes
  );

  // A Map iterates in insertion order and use() re-inserts, so the least
  // recently used entry comes first.
  const entries = new Map<string, Entry>();
  let totalBytes = 0;
  const inFlight = new Map<string, Promise<Snapshot>>();

  const remove = (key: string) => {
    const entry = entries.get(key);
    if (entry !== undefined) {
      entries.delete(key);
      totalBytes -= entry.bytes;
    }
  };

  const use = (key: string, entry: Entry) => {
    entries.delete(key);
    entries.set(key, entry);
  };

  const store = (key: string, entry: Entry) => {
    remove(key);
    entries.set(key, entry);
    totalBytes += entry.bytes;
    for (const oldest of entries.keys()) {
      if (entries.size <= maxEntries && totalBytes <= maxBytes) {
        break;
      }
      remove(oldest);
    }
  };

  /** Drops a stale entry a refresh superseded, so it can never answer again. */
  const forget = (key: string, stale: Entry | undefined) => {
    if (stale !== undefined && entries.get(key) === stale) {
      remove(key);
    }
  };

  /** Answers a failed refresh with the stale entry, when stale-if-error allows. */
  const answerWithStale = (
    key: string,
    stale: Entry,
    url: string,
    failure: string,
    retryAfterSeconds: number
  ) => {
    const time = now();
    if (time >= stale.staleUntil) {
      return false;
    }
    // Back off: until retryAt the stale entry answers without a request, so a
    // sustained 429 costs one request per backoff, not one per page view.
    stale.retryAt =
      time + Math.min(retryAfterSeconds, MAX_RETRY_AFTER_SECONDS) * 1000;
    if (entries.get(key) === stale) {
      use(key, stale);
    }
    console.warn(
      `Resource cache: refreshing ${describeUrl(url)} failed (${failure}); serving the stored response`
    );
    return true;
  };

  const refresh = async (
    key: string,
    url: string,
    init: RequestInit | undefined,
    stale: Entry | undefined,
    hasAuthorization: boolean
  ): Promise<Snapshot> => {
    const requestedAt = now();
    let response: Response;
    let body: string;
    try {
      response = await underlyingFetch(url, init);
      body = await response.text();
    } catch (error) {
      if (
        stale !== undefined &&
        answerWithStale(key, stale, url, "network error", DEFAULT_RETRY_SECONDS)
      ) {
        return stale.snapshot;
      }
      forget(key, stale);
      throw error;
    }

    const { status } = response;
    if (stale !== undefined && FAILED_REFRESH_STATUSES.has(status)) {
      const retryAfter =
        status === 429 || status === 503
          ? parseSeconds(response.headers.get("retry-after"))
          : undefined;
      if (
        answerWithStale(
          key,
          stale,
          url,
          `status ${status}`,
          retryAfter ?? DEFAULT_RETRY_SECONDS
        )
      ) {
        return stale.snapshot;
      }
    }

    const snapshot: Snapshot = {
      status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type"),
      body,
    };
    const directives = parseDirectives(response.headers.get("cache-control"));
    const freshSeconds = getFreshSeconds(
      response,
      directives,
      hasAuthorization
    );
    const bytes =
      freshSeconds === undefined ? 0 : encoder.encode(body).byteLength;
    if (freshSeconds !== undefined && bytes <= maxEntryBytes) {
      const freshUntil = requestedAt + freshSeconds * 1000;
      const staleIfError = Math.min(
        parseSeconds(directives.get("stale-if-error")) ?? 0,
        MAX_STALE_IF_ERROR_SECONDS
      );
      store(key, {
        snapshot,
        bytes,
        freshUntil,
        staleUntil: freshUntil + staleIfError * 1000,
        retryAt: 0,
      });
    } else {
      // Not stored, so the old entry is out of date: a 401 or a 404 must show,
      // now and after any later failure.
      forget(key, stale);
    }
    return snapshot;
  };

  return async (input, init) => {
    // The sdk passes a string URL; anything else goes straight through.
    if (
      typeof input !== "string" ||
      (init?.method ?? "GET").toUpperCase() !== "GET" ||
      init?.body != null
    ) {
      return underlyingFetch(input, init);
    }
    let headers: Headers;
    try {
      headers = new Headers(init?.headers);
    } catch {
      return underlyingFetch(input, init);
    }
    if (headers.has("cache-control")) {
      return underlyingFetch(input, init);
    }

    const key = JSON.stringify([
      "GET",
      input,
      [...headers].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ]);
    const entry = entries.get(key);
    const time = now();
    if (
      entry !== undefined &&
      (time < entry.freshUntil ||
        (time < entry.retryAt && time < entry.staleUntil))
    ) {
      use(key, entry);
      return toResponse(entry.snapshot);
    }

    // One request per key at a time. The slot is released however the
    // refresh ends, so a failure never stays under the key.
    let pending = inFlight.get(key);
    if (pending === undefined) {
      pending = refresh(
        key,
        input,
        init,
        entry,
        headers.has("authorization")
      ).finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, pending);
    }
    return toResponse(await pending);
  };
};
