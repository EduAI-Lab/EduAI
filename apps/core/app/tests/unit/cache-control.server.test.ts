// @vitest-environment node
// #1453 — the reference-read cache header. The 200-only guard is the whole
// point: caching a 401/403/404 would pin a denial in the browser past the
// login / role grant that fixes it.
import { describe, it, expect } from "vitest";

import { REFERENCE_MAX_AGE, withReferenceCache } from "~/lib/api/cache-control.server";

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

  it("keeps every TTL short enough that an admin edit is not shadowed for long", () => {
    for (const maxAge of Object.values(REFERENCE_MAX_AGE)) {
      expect(maxAge).toBeGreaterThan(0);
      expect(maxAge).toBeLessThanOrEqual(120);
    }
  });
});
