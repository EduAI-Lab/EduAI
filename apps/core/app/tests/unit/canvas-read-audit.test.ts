// @vitest-environment node

/**
 * #1084 requires a security event per *delegated* Canvas use: the QM-facing quiz
 * and question-bank proxies open a socket to Canvas under the caller's own Canvas
 * token, so each read must be recorded with actor + resource metadata (and never
 * the token or the Canvas payload). Writes already log `CANVAS_QUIZ_WRITE`; these
 * tests pin the read half of that contract, success and failure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/policy.server", () => ({
  getPolicy: vi.fn().mockResolvedValue(true),
  logPolicyDenial: vi.fn(),
}));

vi.mock("~/lib/canvas/guards.server", () => ({
  canManageCanvasIntegration: vi.fn(() => true),
  canLinkCanvasRoster: vi.fn(() => false),
  isCanvasLinkRosterRateLimited: vi.fn(() => false),
  isCanvasSyncRateLimited: vi.fn(() => false),
}));

vi.mock("~/lib/canvas/integration.server", () => ({
  getCanvasIntegrationPublic: vi.fn().mockResolvedValue(null),
  getCanvasIntegrationWithDecryptedKey: vi
    .fn()
    .mockResolvedValue({ canvasUrl: "https://canvas.test", apiKey: "secret-token" }),
  saveCanvasIntegration: vi.fn(),
  deleteCanvasIntegration: vi.fn(),
  CanvasStoredCredentialsError: class extends Error {},
}));

vi.mock("~/lib/canvas/courses.server", () => ({
  CanvasNotConnectedError: class extends Error {},
  InvalidCanvasCourseAccessError: class extends Error {},
  listCanvasCoursesWithSyncState: vi.fn(),
  validateInstructorCanvasCourseIds: vi.fn(),
}));

const { CanvasApiErrorMock } = vi.hoisted(() => ({
  CanvasApiErrorMock: class CanvasApiErrorMock extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 500) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock("~/lib/canvas/client.server", () => ({
  CanvasApiError: CanvasApiErrorMock,
  CanvasVerificationError: class extends Error {},
}));

vi.mock("~/lib/canvas/quizzes.server", () => ({
  createCanvasQuiz: vi.fn(),
  createCanvasQuizQuestion: vi.fn(),
  getCanvasQuiz: vi.fn(),
  getCanvasQuizQuestion: vi.fn(),
  listCanvasQuizQuestions: vi.fn(),
  listCanvasQuizzes: vi.fn(),
}));

vi.mock("~/lib/canvas/question-banks.server", () => ({
  getCanvasQuestionBank: vi.fn(),
  listCanvasQuestionBankQuestions: vi.fn(),
  listCanvasQuestionBanks: vi.fn(),
}));

vi.mock("~/lib/canvas/link-roster.server", () => ({
  LinkRosterError: class extends Error {},
  linkCanvasRoster: vi.fn(),
}));

vi.mock("~/lib/canvas/sync.server", () => ({ syncCanvasCourses: vi.fn() }));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn(),
  logAuditAction: vi.fn().mockResolvedValue(undefined),
  logSecurityEvent: vi.fn().mockResolvedValue(undefined),
}));

import { loader } from "~/routes/api/canvas.$";
import { auth } from "~/lib/auth/server";
import { logAuditAction } from "~/lib/logging.server";
import { listCanvasQuizzes, getCanvasQuizQuestion } from "~/lib/canvas/quizzes.server";
import { listCanvasQuestionBanks } from "~/lib/canvas/question-banks.server";

const USER = { id: "u1", role: "INSTRUCTOR", email: "i@t.co" };

function loaderArgs(url: string) {
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: USER } as never);
  return {
    request: new Request(url),
    params: {},
    context: {},
  } as never;
}

/** The single audit entry recorded for the read under test. */
function readEvent() {
  const calls = vi
    .mocked(logAuditAction)
    .mock.calls.filter(([input]) => input.actionCode === "CANVAS_READ");
  expect(calls).toHaveLength(1);
  return calls[0][0];
}

beforeEach(() => vi.clearAllMocks());

describe("Canvas delegated-read audit events (#1084)", () => {
  it("records a SUCCESS event with actor and resource for a quiz list read", async () => {
    vi.mocked(listCanvasQuizzes).mockResolvedValue([{ id: 7 }] as never);

    const res = await loader(loaderArgs("http://localhost/api/canvas/quizzes?canvasCourseId=1234"));

    expect(res.status).toBe(200);
    const event = readEvent();
    expect(event).toMatchObject({
      actionCode: "CANVAS_READ",
      category: "CANVAS",
      outcome: "SUCCESS",
      entityType: "CanvasQuizList",
      entityId: "1234",
      actorUserId: "u1",
    });
    expect(event.details).toMatchObject({ canvasCourseId: 1234 });
  });

  it("records the quiz and question ids for a single-question read", async () => {
    vi.mocked(getCanvasQuizQuestion).mockResolvedValue({ id: 99 } as never);

    const res = await loader(
      loaderArgs("http://localhost/api/canvas/quizzes/55/questions/99?canvasCourseId=1234"),
    );

    expect(res.status).toBe(200);
    expect(readEvent()).toMatchObject({
      outcome: "SUCCESS",
      entityType: "CanvasQuizQuestion",
      entityId: "99",
      details: { canvasCourseId: 1234, quizId: 55, questionId: 99 },
    });
  });

  it("records a SUCCESS event for a question-bank list read", async () => {
    vi.mocked(listCanvasQuestionBanks).mockResolvedValue([{ id: 3 }] as never);

    const res = await loader(
      loaderArgs("http://localhost/api/canvas/question-banks?canvasCourseId=1234"),
    );

    expect(res.status).toBe(200);
    expect(readEvent()).toMatchObject({
      outcome: "SUCCESS",
      entityType: "CanvasQuestionBankList",
      entityId: "1234",
    });
  });

  it("records a FAILURE event with the upstream status when Canvas rejects the read", async () => {
    vi.mocked(listCanvasQuizzes).mockRejectedValue(new CanvasApiErrorMock("Canvas said no", 403));

    const res = await loader(loaderArgs("http://localhost/api/canvas/quizzes?canvasCourseId=1234"));

    expect(res.status).toBe(400);
    const event = readEvent();
    expect(event).toMatchObject({
      outcome: "FAILURE",
      entityType: "CanvasQuizList",
      entityId: "1234",
    });
    expect(event.details).toMatchObject({ canvasStatus: 403, errorType: "CanvasApiErrorMock" });
  });

  it("never records the Canvas token or the Canvas response payload", async () => {
    vi.mocked(listCanvasQuizzes).mockResolvedValue([
      { id: 7, title: "Midterm", secret_field: "x" },
    ] as never);

    await loader(loaderArgs("http://localhost/api/canvas/quizzes?canvasCourseId=1234"));

    const serialized = JSON.stringify(readEvent());
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("secret_field");
    expect(serialized).not.toContain("Midterm");
  });
});
