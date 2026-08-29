import { afterEach, describe, expect, it, vi } from "vitest";

const { assertPublicHostnameMock } = vi.hoisted(() => ({
  assertPublicHostnameMock: vi.fn(async (_hostname: string) => {}),
}));

vi.mock("~/lib/net/ssrf-guard.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/net/ssrf-guard.server")>()),
  assertPublicHostname: (hostname: string) => assertPublicHostnameMock(hostname),
}));

import { CanvasApiError, canvasRequestJson } from "~/lib/canvas/client.server";

const NON_TEST_CREDENTIALS = {
  canvasUrl: "http://localhost:8080",
  apiKey: "token",
  isTestMode: false,
} as const;

const TEST_CREDENTIALS = {
  canvasUrl: "http://localhost:8080",
  apiKey: "test",
  isTestMode: true,
} as const;

describe("canvasRequestJson", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    assertPublicHostnameMock.mockReset();
    assertPublicHostnameMock.mockImplementation(async () => {});
  });

  it("GET sends Authorization Bearer, redirect manual, and returns JSON data", async () => {
    const payload = { id: 42, title: "Midterm Quiz" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })),
    );

    const data = await canvasRequestJson(NON_TEST_CREDENTIALS, "/courses/1/quizzes/42");

    expect(data).toEqual(payload);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/courses/1/quizzes/42",
      expect.objectContaining({
        headers: { Authorization: "Bearer token" },
        redirect: "manual",
      }),
    );
  });

  it("POST sends method POST, Content-Type application/json, and stringified body", async () => {
    const body = { quiz: { title: "New Quiz", quiz_type: "assignment" } };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: 99, title: "New Quiz" }), { status: 200 }),
        ),
    );

    const data = await canvasRequestJson(NON_TEST_CREDENTIALS, "/courses/1/quizzes", {
      method: "POST",
      body,
    });

    expect(data).toEqual({ id: 99, title: "New Quiz" });
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/courses/1/quizzes",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        redirect: "manual",
      }),
    );
  });

  it("throws CanvasApiError on redirect (302) instead of following", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1:5432/" },
        }),
      ),
    );

    await expect(
      canvasRequestJson(NON_TEST_CREDENTIALS, "/courses/1/quizzes"),
    ).rejects.toMatchObject({
      message: "Canvas redirected the request to an unvalidated host",
      statusCode: 502,
    });
  });

  it("returns mock quiz list in test mode without calling fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const data = await canvasRequestJson(TEST_CREDENTIALS, "/courses/1/quizzes");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(data).toEqual([
      { id: 1, title: "Test Quiz 1", quiz_type: "assignment", published: false },
      { id: 2, title: "Test Quiz 2", quiz_type: "assignment", published: true },
    ]);
  });
});
