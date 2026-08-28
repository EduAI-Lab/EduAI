// @vitest-environment node
//
// Regressions for the Canvas egress budgets and base-URL contract that moved
// into Core when QM's direct Canvas client was deleted (#1084, #1509 review):
// sub-path deployments, canonical base URLs, and request/response size limits.

import { afterEach, describe, expect, it, vi } from "vitest";

const { assertPublicHostnameMock } = vi.hoisted(() => ({
  assertPublicHostnameMock: vi.fn(async (_hostname: string) => {}),
}));

vi.mock("~/lib/net/ssrf-guard.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/net/ssrf-guard.server")>()),
  assertPublicHostname: (hostname: string) => assertPublicHostnameMock(hostname),
}));

import {
  CANVAS_MAX_REQUEST_BODY_BYTES,
  CANVAS_MAX_RESPONSE_BYTES,
  CANVAS_PERMISSION_DENIED_ERROR,
  CANVAS_REQUEST_BODY_LIMIT_ERROR,
  CANVAS_RESPONSE_LIMIT_ERROR,
  CANVAS_URL_CREDENTIALS_ERROR,
  CANVAS_URL_QUERY_OR_FRAGMENT_ERROR,
  canonicalCanvasBaseUrl,
  canvasRequestJson,
  parseAndValidateCanvasUrl,
} from "~/lib/canvas/client.server";

const SUBPATH_CREDENTIALS = {
  canvasUrl: "http://localhost:8080/ubc",
  apiKey: "token",
  isTestMode: false,
} as const;

const CREDENTIALS = {
  canvasUrl: "http://localhost:8080",
  apiKey: "token",
  isTestMode: false,
} as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  assertPublicHostnameMock.mockReset();
  assertPublicHostnameMock.mockImplementation(async () => {});
});

describe("Canvas base URL canonicalization", () => {
  it("rejects a base URL carrying embedded credentials", () => {
    expect(() => parseAndValidateCanvasUrl("https://user:pass@canvas.example.edu")).toThrow(
      CANVAS_URL_CREDENTIALS_ERROR,
    );
  });

  it("rejects a base URL carrying a query string", () => {
    expect(() =>
      parseAndValidateCanvasUrl("https://canvas.example.edu/?redirect=http://169.254.169.254"),
    ).toThrow(CANVAS_URL_QUERY_OR_FRAGMENT_ERROR);
  });

  it("rejects a base URL carrying a fragment", () => {
    expect(() => parseAndValidateCanvasUrl("https://canvas.example.edu/#frag")).toThrow(
      CANVAS_URL_QUERY_OR_FRAGMENT_ERROR,
    );
  });

  it("accepts a sub-path deployment and canonicalizes away the trailing slash", () => {
    const parsed = parseAndValidateCanvasUrl("https://lms.example.edu/ubc/");

    expect(canonicalCanvasBaseUrl(parsed)).toBe("https://lms.example.edu/ubc");
  });

  it("canonicalizes an origin-only base URL to the bare origin", () => {
    expect(canonicalCanvasBaseUrl(parseAndValidateCanvasUrl("https://lms.example.edu/"))).toBe(
      "https://lms.example.edu",
    );
  });
});

describe("Canvas sub-path deployments", () => {
  it("preserves the configured base path when building an API URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 200 })),
    );

    await canvasRequestJson(SUBPATH_CREDENTIALS, "/courses/1/quizzes/42");

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8080/ubc/api/v1/courses/1/quizzes/42",
      expect.anything(),
    );
  });

  it("preserves the configured base path when verifying credentials", async () => {
    const { verifyCanvasCredentials } = await import("~/lib/canvas/client.server");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 200 })),
    );

    await verifyCanvasCredentials("http://localhost:8080/ubc", "token");

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8080/ubc/api/v1/users/self/profile",
      expect.anything(),
    );
  });
});

describe("Canvas egress size budgets", () => {
  it("refuses a write body larger than the request budget without calling fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const oversized = "x".repeat(CANVAS_MAX_REQUEST_BODY_BYTES + 1);

    await expect(
      canvasRequestJson(CREDENTIALS, "/courses/1/quizzes", {
        method: "POST",
        body: { quiz: { title: oversized } },
      }),
    ).rejects.toMatchObject({
      message: CANVAS_REQUEST_BODY_LIMIT_ERROR,
      statusCode: 413,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts a write body inside the request budget", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 9 }), { status: 200 })),
    );

    await expect(
      canvasRequestJson(CREDENTIALS, "/courses/1/quizzes", {
        method: "POST",
        body: { quiz: { title: "Midterm" } },
      }),
    ).resolves.toEqual({ id: 9 });
  });

  it("rejects a response whose declared Content-Length exceeds the budget", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 1 }), {
          status: 200,
          headers: { "content-length": String(CANVAS_MAX_RESPONSE_BYTES + 1) },
        }),
      ),
    );

    await expect(canvasRequestJson(CREDENTIALS, "/courses/1/quizzes")).rejects.toMatchObject({
      message: CANVAS_RESPONSE_LIMIT_ERROR,
      statusCode: 502,
    });
  });

  it("rejects an undeclared response that streams past the budget", async () => {
    vi.stubEnv("CANVAS_MAX_RESPONSE_BYTES", "64");
    const chunk = new TextEncoder().encode("x".repeat(32));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 8; i += 1) controller.enqueue(chunk);
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));

    await expect(canvasRequestJson(CREDENTIALS, "/courses/1/quizzes")).rejects.toMatchObject({
      message: CANVAS_RESPONSE_LIMIT_ERROR,
      statusCode: 502,
    });
  });

  it("still returns a response that fits inside the budget", async () => {
    vi.stubEnv("CANVAS_MAX_RESPONSE_BYTES", "1024");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify([{ id: 1 }, { id: 2 }]), { status: 200 })),
    );

    await expect(canvasRequestJson(CREDENTIALS, "/courses/1/quizzes")).resolves.toEqual([
      { id: 1 },
      { id: 2 },
    ]);
  });
});

describe("Canvas permission failures", () => {
  it("relays a Canvas 403 as its own code rather than an invalid-token error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));

    await expect(
      canvasRequestJson(CREDENTIALS, "/courses/1/quizzes/42/questions/7"),
    ).rejects.toMatchObject({
      message: CANVAS_PERMISSION_DENIED_ERROR,
      statusCode: 403,
    });
  });

  it("still reports a Canvas 401 as an invalid token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(canvasRequestJson(CREDENTIALS, "/courses/1/quizzes")).rejects.toMatchObject({
      message: "Invalid Canvas API token",
      statusCode: 401,
    });
  });
});
