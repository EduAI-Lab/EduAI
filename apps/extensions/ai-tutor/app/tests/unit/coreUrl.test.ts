/**
 * Cross-app URL builders. They are pure and env-driven, so pin both the
 * configured and the localhost-fallback branch of each.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCoreStatusUrl, getCoreUrl } from "~/lib/coreUrl";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getCoreStatusUrl", () => {
  it("points at Core's status page when Core's origin is configured", () => {
    vi.stubEnv("VITE_CORE_URL", "https://core.example.com");
    expect(getCoreStatusUrl()).toBe("https://core.example.com/status");
  });

  it("falls back to localhost Core, not to a path on this app", () => {
    // A bare "/status" would 404 inside AI Tutor: the page lives in Core.
    vi.stubEnv("VITE_CORE_URL", "");
    expect(getCoreStatusUrl()).toBe("http://localhost:3000/status");
    expect(getCoreStatusUrl()).not.toBe("/status");
  });

  it("builds on the same origin the other Core links use", () => {
    vi.stubEnv("VITE_CORE_URL", "https://core.example.com");
    expect(getCoreStatusUrl().startsWith(getCoreUrl())).toBe(true);
  });
});
