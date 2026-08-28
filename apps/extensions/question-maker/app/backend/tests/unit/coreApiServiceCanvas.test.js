/**
 * Unit tests for Core Canvas proxy helpers in coreApiService.
 * Mocks global fetch — no live Core required.
 */
import { EventEmitter } from "node:events";
import { vi, describe, it, expect, afterEach } from "vitest";

import { canvasRequestContext } from "../../src/middleware/canvasRequestContext.js";

vi.mock("../../src/config/settings.js", () => {
  const cfg = {
    coreUrl: "http://core.test",
    eduaiApiKey: "test-service-key",
  };
  return { config: cfg, default: cfg };
});

const {
  proxyCoreCanvasGetIntegration,
  proxyCoreCanvasConnect,
  proxyCoreCanvasDisconnect,
  proxyCoreCanvasListCourses,
  proxyCoreListQuizzes,
  proxyCoreGetQuiz,
  proxyCoreListQuizQuestions,
  proxyCoreGetQuizQuestion,
  proxyCoreCreateQuiz,
  proxyCoreCreateQuizQuestion,
} = await import("../../src/services/coreApiService.js");

const ok = (data, status = 200) => ({
  ok: status < 400,
  status,
  json: () => Promise.resolve(data),
});

const COOKIE = "session=abc";

afterEach(() => {
  vi.restoreAllMocks();
});

function expectCookieOnlyFetch(url, opts) {
  expect(url).toMatch(/^http:\/\/core\.test\/api\/canvas/);
  expect(opts.headers.cookie).toBe(COOKIE);
  expect(opts.headers.Authorization).toBeUndefined();
}

describe("proxyCoreCanvasGetIntegration", () => {
  it("GETs /api/canvas/integration with cookieOnly auth", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok({ success: true, data: null })));

    const result = await proxyCoreCanvasGetIntegration(COOKIE);

    expect(result).toEqual({ success: true, data: null });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("http://core.test/api/canvas/integration");
    expect(opts.method).toBe("GET");
    expectCookieOnlyFetch(url, opts);
  });
});

describe("proxyCoreCanvasConnect", () => {
  it("POSTs /api/canvas/connect with the body and cookieOnly auth", async () => {
    const body = { canvasUrl: "https://canvas.ubc.ca", apiKey: "pat", isTestMode: false };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(ok({ success: true, data: { canvasUrl: body.canvasUrl } })),
    );

    await proxyCoreCanvasConnect(COOKIE, body);

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("http://core.test/api/canvas/connect");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual(body);
    expectCookieOnlyFetch(url, opts);
  });
});

describe("proxyCoreCanvasDisconnect", () => {
  it("DELETEs /api/canvas/disconnect with cookieOnly auth", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(ok({ success: true, message: "disconnected" })),
    );

    await proxyCoreCanvasDisconnect(COOKIE);

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("http://core.test/api/canvas/disconnect");
    expect(opts.method).toBe("DELETE");
    expectCookieOnlyFetch(url, opts);
  });
});

describe("proxyCoreCanvasListCourses", () => {
  it("GETs /api/canvas/courses with cookieOnly auth", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(ok({ success: true, data: { courses: [] } })),
    );

    await proxyCoreCanvasListCourses(COOKIE);

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("http://core.test/api/canvas/courses");
    expectCookieOnlyFetch(url, opts);
  });
});

describe("proxyCoreListQuizzes", () => {
  it("GETs /api/canvas/quizzes?canvasCourseId= with cookieOnly auth", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok({ success: true, data: [{ id: 1 }] })));

    const result = await proxyCoreListQuizzes(COOKIE, 42);

    expect(result).toEqual({ success: true, data: [{ id: 1 }] });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("http://core.test/api/canvas/quizzes?canvasCourseId=42");
    expectCookieOnlyFetch(url, opts);
  });
});

describe("proxyCoreGetQuiz", () => {
  it("GETs /api/canvas/quizzes/:quizId?canvasCourseId= with cookieOnly auth", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok({ success: true, data: { id: 7 } })));

    await proxyCoreGetQuiz(COOKIE, 42, 7);

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("http://core.test/api/canvas/quizzes/7?canvasCourseId=42");
    expectCookieOnlyFetch(url, opts);
  });
});

describe("proxyCoreListQuizQuestions", () => {
  it("GETs /api/canvas/quizzes/:quizId/questions?canvasCourseId= with cookieOnly auth", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok({ success: true, data: [] })));

    await proxyCoreListQuizQuestions(COOKIE, 42, 7);

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("http://core.test/api/canvas/quizzes/7/questions?canvasCourseId=42");
    expectCookieOnlyFetch(url, opts);
  });
});

describe("proxyCoreGetQuizQuestion", () => {
  it("GETs /api/canvas/quizzes/:quizId/questions/:questionId?canvasCourseId= with cookieOnly auth", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok({ success: true, data: { id: 99 } })));

    await proxyCoreGetQuizQuestion(COOKIE, 42, 7, 99);

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("http://core.test/api/canvas/quizzes/7/questions/99?canvasCourseId=42");
    expectCookieOnlyFetch(url, opts);
  });
});

describe("proxyCoreCreateQuiz", () => {
  it("POSTs /api/canvas/quizzes with canvasCourseId and quiz body", async () => {
    const quiz = { title: "Midterm" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(ok({ success: true, data: { id: 501, title: "Midterm" } })),
    );

    await proxyCoreCreateQuiz(COOKIE, 42, quiz);

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("http://core.test/api/canvas/quizzes");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ canvasCourseId: 42, quiz });
    expectCookieOnlyFetch(url, opts);
  });
});

describe("proxyCoreCreateQuizQuestion", () => {
  it("POSTs /api/canvas/quizzes/:quizId/questions with canvasCourseId and question body", async () => {
    const question = { question_name: "Q1", question_type: "multiple_choice_question" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok({ success: true, data: { id: 88 } })));

    await proxyCoreCreateQuizQuestion(COOKIE, 42, 7, question);

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("http://core.test/api/canvas/quizzes/7/questions");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ canvasCourseId: 42, question });
    expectCookieOnlyFetch(url, opts);
  });
});

describe("Canvas proxy auth failures", () => {
  it("does not fall back to the service key when the session cookie is rejected", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok({ error: "CANVAS_NOT_CONNECTED" }, 400));
    vi.stubGlobal("fetch", fetchMock);

    await expect(proxyCoreListQuizzes(COOKIE, 42)).rejects.toMatchObject({
      status: 400,
      body: { error: "CANVAS_NOT_CONNECTED" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});

describe("Canvas proxy cancellation (#1509 review)", () => {
  /**
   * Runs `fn` inside the real `canvasRequestContext`, so the proxy sees the
   * same caller-disconnect signal it would in the Express canvas router.
   */
  function runInCanvasRequest(fn) {
    const req = Object.assign(new EventEmitter(), { complete: true, aborted: false });
    const res = Object.assign(new EventEmitter(), { writableEnded: false });
    let promise;
    canvasRequestContext(req, res, () => {
      promise = fn(req);
    });
    return { req, promise };
  }

  /** Simulates the browser going away mid-request. */
  function disconnect(req) {
    req.aborted = true;
    req.emit("aborted");
  }

  it("hands the caller-disconnect signal to the Core fetch and aborts it on disconnect", async () => {
    let resolveFetch;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { req, promise } = runInCanvasRequest(() => proxyCoreListQuizzes(COOKIE, 42));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const { signal } = fetchMock.mock.calls[0][1];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);

    disconnect(req);
    expect(signal.aborted).toBe(true);

    resolveFetch(ok({ success: true, data: [] }));
    await promise.catch(() => {});
  });

  it("reports a disconnect as CANVAS_REQUEST_CANCELLED instead of a Core failure", async () => {
    let onFetch;
    const fetchMock = vi.fn().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          onFetch = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          init.signal.addEventListener("abort", () => onFetch(), { once: true });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { req, promise } = runInCanvasRequest(() => proxyCoreListQuizzes(COOKIE, 42));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    disconnect(req);

    await expect(promise).rejects.toMatchObject({
      status: 499,
      code: "CANVAS_REQUEST_CANCELLED",
      body: { error: "CANVAS_REQUEST_CANCELLED" },
    });
  });

  it("does not open a Core socket when the caller has already gone away", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { promise } = runInCanvasRequest((req) => {
      disconnect(req);
      return proxyCoreListQuizzes(COOKIE, 42);
    });

    await expect(promise).rejects.toMatchObject({ code: "CANVAS_REQUEST_CANCELLED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
