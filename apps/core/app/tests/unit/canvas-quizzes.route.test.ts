// @vitest-environment node

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
  getCanvasIntegrationWithDecryptedKey: vi.fn(),
  saveCanvasIntegration: vi.fn(),
  deleteCanvasIntegration: vi.fn(),
}));

vi.mock("~/lib/canvas/courses.server", () => ({
  CanvasNotConnectedError: class extends Error {},
  InvalidCanvasCourseAccessError: class extends Error {},
  listCanvasCoursesWithSyncState: vi.fn(),
  validateInstructorCanvasCourseIds: vi.fn(),
}));

vi.mock("~/lib/canvas/client.server", () => ({
  CanvasApiError: class extends Error {},
  CanvasVerificationError: class extends Error {},
}));

vi.mock("~/lib/canvas/link-roster.server", () => ({
  LinkRosterError: class extends Error {},
  linkCanvasRoster: vi.fn(),
}));

vi.mock("~/lib/canvas/sync.server", () => ({ syncCanvasCourses: vi.fn() }));

vi.mock("~/lib/canvas/quizzes.server", () => ({
  listCanvasQuizzes: vi.fn(),
  getCanvasQuiz: vi.fn(),
  listCanvasQuizQuestions: vi.fn(),
  getCanvasQuizQuestion: vi.fn(),
  createCanvasQuiz: vi.fn(),
  createCanvasQuizQuestion: vi.fn(),
  deleteCanvasQuiz: vi.fn(),
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn((p: Promise<unknown>) => p),
  logAuditAction: vi.fn().mockResolvedValue(undefined),
  logSecurityEvent: vi.fn().mockResolvedValue(undefined),
}));

import { loader, action } from "~/routes/api/canvas.$";
import { auth } from "~/lib/auth/server";
import { getPolicy } from "~/lib/policy.server";
import { canManageCanvasIntegration } from "~/lib/canvas/guards.server";
import { getCanvasIntegrationWithDecryptedKey } from "~/lib/canvas/integration.server";
import { listCanvasQuizzes, createCanvasQuiz, deleteCanvasQuiz } from "~/lib/canvas/quizzes.server";
import type { JsonValue } from "~/lib/json-value";

const credentials = {
  canvasUrl: "https://canvas.ubc.ca",
  apiKey: "pat-secret",
  isTestMode: false,
};

function makeArgs(path: string, method: string, body?: JsonValue) {
  const init: RequestInit = { method };
  // A GET must carry no body and no JSON content type at all.
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return {
    request: new Request(`http://localhost/api/canvas${path}`, init),
    params: {},
    context: {} as never,
  } as never;
}

async function call(path: string, method: string, body?: JsonValue) {
  return method === "GET"
    ? loader(makeArgs(path, method, body))
    : action(makeArgs(path, method, body));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role: "INSTRUCTOR", email: "u1@ubc.ca" },
  } as never);
  vi.mocked(canManageCanvasIntegration).mockReturnValue(true);
  vi.mocked(getPolicy).mockResolvedValue(true);
  vi.mocked(getCanvasIntegrationWithDecryptedKey).mockResolvedValue({
    id: "int-1",
    userId: "u1",
    ...credentials,
    isConnected: true,
  } as never);
});

it("deletes a quiz through the caller's Canvas integration", async () => {
  vi.mocked(deleteCanvasQuiz).mockResolvedValue({ id: 77, title: "Partial quiz" });

  const response = await call("/quizzes/77?canvasCourseId=9", "DELETE");

  expect(response.status).toBe(200);
  expect(deleteCanvasQuiz).toHaveBeenCalledWith(expect.objectContaining(credentials), 9, 77);
});

describe("GET /api/canvas/quizzes", () => {
  it("returns 401 when there is no session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await call("/quizzes?canvasCourseId=42", "GET");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: "UNAUTHORIZED" });
  });

  it("returns 403 when the role cannot manage Canvas integration", async () => {
    vi.mocked(canManageCanvasIntegration).mockReturnValue(false);
    const res = await call("/quizzes?canvasCourseId=42", "GET");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: "FORBIDDEN" });
  });

  it("returns CANVAS_NOT_CONNECTED when the user has no integration", async () => {
    vi.mocked(getCanvasIntegrationWithDecryptedKey).mockResolvedValue(null);
    const res = await call("/quizzes?canvasCourseId=42", "GET");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: "CANVAS_NOT_CONNECTED" });
  });

  it("lists quizzes for a course", async () => {
    vi.mocked(listCanvasQuizzes).mockResolvedValue([{ id: 1, title: "Quiz 1" }]);
    const res = await call("/quizzes?canvasCourseId=42", "GET");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: [{ id: 1, title: "Quiz 1" }] });
    expect(listCanvasQuizzes).toHaveBeenCalledWith(credentials, 42);
  });
});

describe("POST /api/canvas/quizzes", () => {
  it("returns 400 when the body fails schema validation", async () => {
    const res = await call("/quizzes", "POST", { quiz: { title: "New quiz" } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Invalid input");
    expect(createCanvasQuiz).not.toHaveBeenCalled();
  });
});
