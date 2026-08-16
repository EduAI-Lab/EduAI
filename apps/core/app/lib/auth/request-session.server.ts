// Imported through the `~` alias, not a relative path: every caller and every
// test mocks `~/lib/auth/server`, and Vitest keys module mocks by resolved
// specifier — a relative import here would bind to a second, unmocked instance.
import { auth } from "~/lib/auth/server";
import type { Session } from "~/lib/auth/server";

/**
 * #946: per-request session memo.
 *
 * React Router runs the root loader plus every matched route loader for a
 * single navigation, and each one resolved its own session — so one page view
 * cost 2-4 identical `/get-session` round trips (root middleware + root loader
 * + route loader + shared helpers). The duplication is ACROSS loaders, not
 * within one, so `Promise.all` inside a single loader (root.tsx) never fixed it.
 *
 * The memo is keyed on the `Request` OBJECT, not on the cookie, the user id, or
 * a module-level TTL cache. React Router hands the *same* `Request` instance to
 * the root middleware and to every loader of one navigation, so keying on it
 * dedupes exactly the calls that belong to a single inbound request and nothing
 * else. When the request is done the object becomes unreachable and the WeakMap
 * entry is collected with it — there is no cross-request cache and therefore no
 * revocation window.
 *
 * That last property is the whole point. Better Auth's `session.cookieCache` is
 * intentionally NOT enabled (see `server.ts`): it would serve `getSession()`
 * from a signed cookie snapshot, so the `/get-session` after-hook that
 * deactivates #971 users would stop seeing a live `user.isActive` and a
 * deactivated account would keep full capability for the whole TTL. This memo
 * keeps every request's *first* resolution a live DB read, so that hook still
 * fires on the very next request after `isActive` flips.
 *
 * The PROMISE is cached, not the resolved value, so two callers that start
 * concurrently within one request (e.g. a loader and a helper it calls in
 * `Promise.all`) share one in-flight lookup instead of racing to issue two.
 */
const sessionByRequest = new WeakMap<Request, Promise<Session | null>>();

/** Counters for measuring memo effectiveness (used by tests and dev tooling). */
let resolutionCount = 0;
let memoHitCount = 0;

/**
 * Resolve the Better Auth session for `request`, at most once per request.
 *
 * Drop-in replacement for a direct `auth.api.getSession` call on the request's
 * own headers. Pass the ORIGINAL `Request` the route received — reconstructing one (new
 * headers, a forwarded cookie) is a different key and correctly misses the memo.
 */
export function getRequestSession(request: Request): Promise<Session | null> {
  const memoized = sessionByRequest.get(request);
  if (memoized) {
    memoHitCount += 1;
    return memoized;
  }

  resolutionCount += 1;
  const pending = auth.api.getSession({
    headers: request.headers,
  }) as Promise<Session | null>;
  sessionByRequest.set(request, pending);

  // A failed lookup must not be pinned for the rest of the request; drop it so
  // a later caller retries instead of inheriting a transient DB error. The
  // rejection is still delivered to `pending`'s own consumers.
  pending.catch(() => {
    if (sessionByRequest.get(request) === pending) {
      sessionByRequest.delete(request);
    }
  });

  return pending;
}

/**
 * How many live `getSession` resolutions vs. memo hits have happened.
 * Reset between measurements with `resetRequestSessionMetrics()`.
 */
export function getRequestSessionMetrics(): {
  resolutions: number;
  memoHits: number;
} {
  return { resolutions: resolutionCount, memoHits: memoHitCount };
}

export function resetRequestSessionMetrics(): void {
  resolutionCount = 0;
  memoHitCount = 0;
}
