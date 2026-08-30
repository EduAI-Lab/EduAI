/**
 * Unit tests for the shared `api` axios instance (#1546): the 401 response
 * interceptor that redirects to Core login only on a genuine session-expiry,
 * never on every 401 (e.g. a plain permissions failure elsewhere).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let capturedRejected: ((error: any) => Promise<any>) | undefined;
let capturedFulfilled: ((response: any) => any) | undefined;

const create = vi.fn(() => ({
  interceptors: {
    response: {
      use: (fulfilled: any, rejected: any) => {
        capturedFulfilled = fulfilled;
        capturedRejected = rejected;
      },
    },
  },
}));

vi.mock("axios", () => ({
  default: { create: (...args: unknown[]) => create(...args) },
}));

vi.mock("../../lib/coreUrl", () => ({
  getCoreLoginUrl: () => "https://core.example.com/login?force=1&redirect=x",
}));

describe("api response interceptor", () => {
  const originalLocation = window.location;

  beforeEach(async () => {
    vi.resetModules();
    // @ts-expect-error -- overriding for assertion on redirect
    delete window.location;
    // @ts-expect-error -- minimal stub
    window.location = { href: "https://qm.example.com/" };
    await import("../../services/api");
  });

  afterEach(() => {
    window.location = originalLocation;
    vi.clearAllMocks();
    capturedRejected = undefined;
    capturedFulfilled = undefined;
  });

  it("creates the axios instance with the expected base config", () => {
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
        withCredentials: true,
      }),
    );
  });

  it("passes a successful response through unchanged", () => {
    const response = { status: 200, data: {} };
    expect(capturedFulfilled?.(response)).toBe(response);
  });

  it("redirects to Core login on a session-expired 401", async () => {
    const error = {
      response: { status: 401, data: { error: "Authentication required" } },
      config: { url: "/api/course" },
    };

    await expect(capturedRejected?.(error)).rejects.toBe(error);
    expect(window.location.href).toBe("https://core.example.com/login?force=1&redirect=x");
  });

  it("redirects on an Unauthorized 401 from /api/auth/me specifically", async () => {
    const error = {
      response: { status: 401, data: { error: "Unauthorized" } },
      config: { url: "/api/auth/me" },
    };

    await expect(capturedRejected?.(error)).rejects.toBe(error);
    expect(window.location.href).toBe("https://core.example.com/login?force=1&redirect=x");
  });

  it("does not redirect on an Unauthorized 401 from a different endpoint", async () => {
    const error = {
      response: { status: 401, data: { error: "Unauthorized" } },
      config: { url: "/api/course/5" },
    };

    await expect(capturedRejected?.(error)).rejects.toBe(error);
    expect(window.location.href).toBe("https://qm.example.com/");
  });

  it("does not redirect on a non-401 error", async () => {
    const error = { response: { status: 500, data: { error: "boom" } }, config: { url: "/api/x" } };

    await expect(capturedRejected?.(error)).rejects.toBe(error);
    expect(window.location.href).toBe("https://qm.example.com/");
  });

  it("does not redirect when there is no response object (network error)", async () => {
    const error = { message: "Network Error" };

    await expect(capturedRejected?.(error)).rejects.toBe(error);
    expect(window.location.href).toBe("https://qm.example.com/");
  });
});
