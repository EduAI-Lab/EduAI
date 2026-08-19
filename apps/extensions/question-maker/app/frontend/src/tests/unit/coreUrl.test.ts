/**
 * #1574 — QM logout (and the api.ts 401 interceptor) send the user to Core
 * login with a `redirect` back to this extension instead of a bare `/login`,
 * so re-login returns them here rather than stranding them on Core. The
 * cross-app URL builders are pure and env-driven, so pin both the configured
 * and the localhost-fallback branch of each.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAiTutorInstructorUrl,
  getAiTutorUrl,
  getCoreDashboardUrl,
  getCoreLoginUrl,
  getCoreUrl,
} from "../../lib/coreUrl";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getCoreUrl", () => {
  it("uses VITE_CORE_URL when set", () => {
    vi.stubEnv("VITE_CORE_URL", "https://core.example.com");
    expect(getCoreUrl()).toBe("https://core.example.com");
  });

  it("falls back to localhost when unset", () => {
    vi.stubEnv("VITE_CORE_URL", "");
    expect(getCoreUrl()).toBe("http://localhost:3000");
  });
});

describe("getCoreLoginUrl", () => {
  it("forces re-login and round-trips the return URL", () => {
    vi.stubEnv("VITE_CORE_URL", "https://core.example.com");
    const returnUrl = "https://qm.example.com/courses/42?tab=banks";
    expect(getCoreLoginUrl(returnUrl)).toBe(
      `https://core.example.com/login?force=1&redirect=${encodeURIComponent(returnUrl)}`,
    );
  });

  it("defaults the return URL to the current location", () => {
    vi.stubEnv("VITE_CORE_URL", "https://core.example.com");
    expect(getCoreLoginUrl()).toBe(
      `https://core.example.com/login?force=1&redirect=${encodeURIComponent(window.location.href)}`,
    );
  });

  it("encodes a return URL that itself carries a redirect param", () => {
    vi.stubEnv("VITE_CORE_URL", "https://core.example.com");
    const nested = "https://qm.example.com/?next=https://x.test/a%3Fb%3D1";
    const url = new URL(getCoreLoginUrl(nested));
    expect(url.searchParams.get("redirect")).toBe(nested);
    expect(url.searchParams.get("force")).toBe("1");
  });
});

describe("getCoreDashboardUrl", () => {
  it("appends /dashboard to the Core base", () => {
    vi.stubEnv("VITE_CORE_URL", "https://core.example.com");
    expect(getCoreDashboardUrl()).toBe("https://core.example.com/dashboard");
  });
});

describe("getAiTutorUrl", () => {
  it("uses VITE_AI_TUTOR_URL when set", () => {
    vi.stubEnv("VITE_AI_TUTOR_URL", "https://tutor.example.com");
    expect(getAiTutorUrl()).toBe("https://tutor.example.com");
  });

  it("falls back to localhost when unset", () => {
    vi.stubEnv("VITE_AI_TUTOR_URL", "");
    expect(getAiTutorUrl()).toBe("http://localhost:3001");
  });
});

describe("getAiTutorInstructorUrl", () => {
  it("returns the bare instructor URL with no course id", () => {
    vi.stubEnv("VITE_AI_TUTOR_URL", "https://tutor.example.com");
    expect(getAiTutorInstructorUrl()).toBe("https://tutor.example.com/instructor");
  });

  it("treats a whitespace-only course id as absent", () => {
    vi.stubEnv("VITE_AI_TUTOR_URL", "https://tutor.example.com");
    expect(getAiTutorInstructorUrl({ coreCourseId: "   " })).toBe(
      "https://tutor.example.com/instructor",
    );
  });

  it("treats a null course id as absent", () => {
    vi.stubEnv("VITE_AI_TUTOR_URL", "https://tutor.example.com");
    expect(getAiTutorInstructorUrl({ coreCourseId: null })).toBe(
      "https://tutor.example.com/instructor",
    );
  });

  it("appends and encodes a present course id", () => {
    vi.stubEnv("VITE_AI_TUTOR_URL", "https://tutor.example.com");
    expect(getAiTutorInstructorUrl({ coreCourseId: "core/7 8" })).toBe(
      `https://tutor.example.com/instructor?coreCourseId=${encodeURIComponent("core/7 8")}`,
    );
  });
});
