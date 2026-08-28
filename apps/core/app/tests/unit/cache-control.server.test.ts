// @vitest-environment node
// #1453 — the two Cache-Control helpers.
//
// `withReferenceCache` is for bodies identical for every caller; its 200-only
// guard is the whole point, since caching a 401/403/404 would pin a denial in
// the browser past the login / role grant that fixes it.
//
// `withNoStore` is for everything scoped to a user or varying by role. The
// browser cache key is method + URL with no session component, so anything
// stored there is served to the next account on the same profile.
import { describe, it, expect } from "vitest";

import { REFERENCE_MAX_AGE, withNoStore, withReferenceCache } from "~/lib/api/cache-control.server";

const res = (status: number) => new Response("{}", { status });

describe("withReferenceCache", () => {
  it("marks a 200 private with the given max-age", () => {
    const out = withReferenceCache(res(200), 30);
    expect(out.headers.get("Cache-Control")).toBe("private, max-age=30");
  });

  it.each([401, 403, 404, 500])("leaves a %i uncached", (status) => {
    const out = withReferenceCache(res(status), 30);
    expect(out.headers.get("Cache-Control")).toBeNull();
  });

  it("never allows a shared cache to hold a scoped body", () => {
    for (const maxAge of Object.values(REFERENCE_MAX_AGE)) {
      expect(withReferenceCache(res(200), maxAge).headers.get("Cache-Control")).toMatch(
        /^private,/,
      );
    }
  });

  it("keeps every TTL short enough that an edit is not shadowed for long", () => {
    for (const maxAge of Object.values(REFERENCE_MAX_AGE)) {
      expect(maxAge).toBeGreaterThan(0);
      expect(maxAge).toBeLessThanOrEqual(120);
    }
  });

  // The review guard: `private` does NOT key the browser entry by session, so
  // the table may only ever list reads whose body is the same for every caller.
  // A new entry here is a security decision — go read the module comment first.
  it("only covers reads whose body does not vary by caller", () => {
    expect(Object.keys(REFERENCE_MAX_AGE)).toEqual(["disciplines"]);
  });
});

describe("withNoStore", () => {
  it("forbids storing a 200", () => {
    expect(withNoStore(res(200)).headers.get("Cache-Control")).toBe("no-store");
  });

  // A stored 403 outlives the role grant that resolves it, exactly as a stored
  // 200 outlives the session that earned it — so this one covers every status.
  it.each([401, 403, 404, 500])("forbids storing a %i too", (status) => {
    expect(withNoStore(res(status)).headers.get("Cache-Control")).toBe("no-store");
  });

  it("overwrites a cache header already on the response", () => {
    const already = res(200);
    already.headers.set("Cache-Control", "private, max-age=30");
    expect(withNoStore(already).headers.get("Cache-Control")).toBe("no-store");
  });
});
