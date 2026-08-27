import { afterEach, describe, expect, it, vi } from "vitest";

const { assertPublicHostnameMock } = vi.hoisted(() => ({
  assertPublicHostnameMock: vi.fn(async (_hostname: string) => {}),
}));

vi.mock("~/lib/net/ssrf-guard.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/net/ssrf-guard.server")>()),
  assertPublicHostname: (hostname: string) => assertPublicHostnameMock(hostname),
}));

import {
  createCanvasQuiz,
  createCanvasQuizQuestion,
  getCanvasQuiz,
  getCanvasQuizQuestion,
  listCanvasQuizQuestions,
  listCanvasQuizzes,
} from "~/lib/canvas/quizzes.server";
import {
  CanvasCourseIdQuerySchema,
  CreateCanvasQuizBodySchema,
  CreateCanvasQuizQuestionBodySchema,
} from "~/lib/canvas/schemas";

const TEST_CREDENTIALS = {
  canvasUrl: "http://localhost:8080",
  apiKey: "test",
  isTestMode: true,
} as const;

const NON_TEST_CREDENTIALS = {
  canvasUrl: "http://localhost:8080",
  apiKey: "token",
  isTestMode: false,
} as const;

describe("canvas quiz helpers (test mode)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("listCanvasQuizzes returns mock quiz list without calling fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const quizzes = await listCanvasQuizzes(TEST_CREDENTIALS, 1, fetchSpy);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(quizzes).toEqual([
      { id: 1, title: "Test Quiz 1", quiz_type: "assignment", published: false },
      { id: 2, title: "Test Quiz 2", quiz_type: "assignment", published: true },
    ]);
  });

  it("getCanvasQuiz returns a single mock quiz", async () => {
    const quiz = await getCanvasQuiz(TEST_CREDENTIALS, 1, 42);

    expect(quiz).toEqual({
      id: 42,
      title: "Test Quiz",
      quiz_type: "assignment",
      published: false,
    });
  });

  it("listCanvasQuizQuestions returns mock questions", async () => {
    const questions = await listCanvasQuizQuestions(TEST_CREDENTIALS, 1, 42);

    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      id: 1,
      question_name: "1. Test Question",
      question_type: "multiple_choice_question",
    });
  });

  it("getCanvasQuizQuestion returns a single mock question by id", async () => {
    const question = await getCanvasQuizQuestion(TEST_CREDENTIALS, 1, 42, 7);

    expect(question).toMatchObject({
      id: 7,
      question_name: "1. Test Question",
      question_type: "multiple_choice_question",
    });
  });

  it("createCanvasQuiz POSTs { quiz } wrapper and returns created quiz", async () => {
    const quizPayload = {
      title: "Midterm",
      quiz_type: "assignment",
      published: false,
    };

    const created = await createCanvasQuiz(TEST_CREDENTIALS, 1, quizPayload);

    expect(created).toMatchObject({
      title: "Midterm",
    });
    expect(created.id).toEqual(expect.any(Number));
  });

  it("createCanvasQuizQuestion POSTs { question } wrapper and returns created question", async () => {
    const questionPayload = {
      question_name: "1. Sample",
      question_text: "Pick one",
      question_type: "multiple_choice_question",
    };

    const created = await createCanvasQuizQuestion(TEST_CREDENTIALS, 1, 42, questionPayload);

    expect(created.id).toEqual(expect.any(Number));
  });
});

describe("canvas quiz helpers (live fetch)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    assertPublicHostnameMock.mockReset();
    assertPublicHostnameMock.mockImplementation(async () => {});
  });

  it("createCanvasQuiz sends POST to /api/v1/courses/:id/quizzes with { quiz } body", async () => {
    const quizPayload = { title: "Export Quiz", quiz_type: "assignment" };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 501, title: "Export Quiz" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const created = await createCanvasQuiz(NON_TEST_CREDENTIALS, 999, quizPayload, fetchMock);

    expect(created).toEqual({ id: 501, title: "Export Quiz" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/courses/999/quizzes",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ quiz: quizPayload }),
        redirect: "manual",
      }),
    );
  });
});

describe("canvas quiz schemas", () => {
  it("CanvasCourseIdQuerySchema coerces canvasCourseId to a positive integer", () => {
    const result = CanvasCourseIdQuerySchema.safeParse({ canvasCourseId: "42" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.canvasCourseId).toBe(42);
    }
  });

  it("CreateCanvasQuizBodySchema requires canvasCourseId and quiz record", () => {
    const result = CreateCanvasQuizBodySchema.safeParse({
      canvasCourseId: "1",
      quiz: { title: "Quiz", quiz_type: "assignment" },
    });
    expect(result.success).toBe(true);
  });

  it("CreateCanvasQuizQuestionBodySchema requires canvasCourseId and question record", () => {
    const result = CreateCanvasQuizQuestionBodySchema.safeParse({
      canvasCourseId: "1",
      question: { question_name: "Q1", question_text: "Hello" },
    });
    expect(result.success).toBe(true);
  });
});

describe("canvas quiz collection pagination (#1509 review)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * A Canvas list response: `Link: rel="next"` on every page but the last, so
   * the helper under test has to walk it the way Canvas expects.
   */
  function page(items: unknown[], nextUrl?: string): Response {
    return new Response(JSON.stringify(items), {
      status: 200,
      headers: nextUrl ? { link: `<${nextUrl}>; rel="next"` } : {},
    });
  }

  it("listCanvasQuizzes follows Link: rel=next across pages", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        page([{ id: 1, title: "Q1" }], "http://localhost:8080/api/v1/courses/7/quizzes?page=2"),
      )
      .mockResolvedValueOnce(
        page([{ id: 2, title: "Q2" }], "http://localhost:8080/api/v1/courses/7/quizzes?page=3"),
      )
      .mockResolvedValueOnce(page([{ id: 3, title: "Q3" }]));
    vi.stubGlobal("fetch", fetchMock);

    const quizzes = await listCanvasQuizzes(NON_TEST_CREDENTIALS, 7, fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(quizzes.map((quiz) => quiz.id)).toEqual([1, 2, 3]);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:8080/api/v1/courses/7/quizzes?per_page=100",
    );
  });

  it("listCanvasQuizQuestions follows Link: rel=next across pages", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        page([{ id: 10 }], "http://localhost:8080/api/v1/courses/7/quizzes/3/questions?page=2"),
      )
      .mockResolvedValueOnce(page([{ id: 11 }, { id: 12 }]));
    vi.stubGlobal("fetch", fetchMock);

    const questions = await listCanvasQuizQuestions(NON_TEST_CREDENTIALS, 7, 3, fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(questions.map((question) => question.id)).toEqual([10, 11, 12]);
  });

  it("refuses a pagination link that leaves the configured Canvas origin", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([{ id: 1, title: "Q1" }], "http://169.254.169.254/api/v1/x"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listCanvasQuizzes(NON_TEST_CREDENTIALS, 7, fetchMock)).rejects.toMatchObject({
      statusCode: 502,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
