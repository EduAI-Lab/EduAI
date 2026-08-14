/**
 * @vitest-environment node
 *
 * Route tests for /api/courses/:courseId/banks* (#845).
 * Mocks auth + bank server helpers — no DB.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  requireServiceKey: vi.fn(),
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn(),
}));

vi.mock("~/lib/question-banks/server", () => ({
  listQuestionBanks: vi.fn(),
  createQuestionBank: vi.fn(),
  updateQuestionBank: vi.fn(),
  deleteQuestionBank: vi.fn(),
  listBankMemberships: vi.fn(),
  addQuestionToBank: vi.fn(),
  removeQuestionFromBank: vi.fn(),
}));

import { action, loader } from "~/routes/api/courses.banks.$";
import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import {
  addQuestionToBank,
  createQuestionBank,
  deleteQuestionBank,
  listBankMemberships,
  listQuestionBanks,
  removeQuestionFromBank,
  updateQuestionBank,
} from "~/lib/question-banks/server";

const COURSE_ID = "course_1";
const BANK = {
  id: "bank_1",
  courseId: COURSE_ID,
  name: "Extra",
  isDefault: false,
};

function sessionInstructor() {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role: "INSTRUCTOR" },
  } as never);
  vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
    course: { id: COURSE_ID, isPublished: true },
    access: { level: "instructor" },
  } as never);
}

function args(
  method: string,
  splat: string | undefined,
  {
    body,
    bearer,
    url = `http://localhost/api/courses/${COURSE_ID}/banks${splat ? `/${splat}` : ""}`,
  }: { body?: unknown; bearer?: boolean; url?: string } = {},
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (bearer) headers.Authorization = "Bearer test-key";
  return {
    request: new Request(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    params: { courseId: COURSE_ID, "*": splat },
    context: {} as never,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireServiceKey).mockResolvedValue(null);
  sessionInstructor();
});

describe("GET /api/courses/:courseId/banks", () => {
  it("400 when courseId is missing", async () => {
    const res = await loader({
      request: new Request("http://localhost/api/courses//banks"),
      params: {},
      context: {} as never,
    } as any);
    expect(res.status).toBe(400);
  });

  it("401 without a session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await loader(args("GET", undefined));
    expect(res.status).toBe(401);
  });

  it("404 when the course is missing", async () => {
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: null,
      access: null,
    } as never);
    const res = await loader(args("GET", undefined));
    expect(res.status).toBe(404);
  });

  it("403 when the viewer has no course access", async () => {
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: COURSE_ID, isPublished: true },
      access: null,
    } as never);
    const res = await loader(args("GET", undefined));
    expect(res.status).toBe(403);
  });

  it("403 when a student views an unpublished course", async () => {
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: COURSE_ID, isPublished: false },
      access: { level: "student" },
    } as never);
    const res = await loader(args("GET", undefined));
    expect(res.status).toBe(403);
  });

  it("lists banks for an instructor session", async () => {
    vi.mocked(listQuestionBanks).mockResolvedValue([BANK] as never);
    const res = await loader(args("GET", undefined));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ banks: [BANK] });
  });

  it("lists banks with a valid service key (no session)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    vi.mocked(listQuestionBanks).mockResolvedValue([BANK] as never);
    const res = await loader(args("GET", undefined, { bearer: true }));
    expect(requireServiceKey).toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ banks: [BANK] });
  });

  it("rejects an invalid service key", async () => {
    vi.mocked(requireServiceKey).mockResolvedValue(
      new Response(JSON.stringify({ error: "INVALID_SERVICE_KEY" }), {
        status: 403,
      }),
    );
    const res = await loader(args("GET", undefined, { bearer: true }));
    expect(res.status).toBe(403);
  });

  it("lists memberships for a bank", async () => {
    vi.mocked(listBankMemberships).mockResolvedValue({
      memberships: [{ id: "m1", externalQuestionId: "42" }],
    } as never);
    const res = await loader(args("GET", "bank_1/questions"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      memberships: [{ id: "m1" }],
    });
  });

  it("404 when listing memberships for a missing bank", async () => {
    vi.mocked(listBankMemberships).mockResolvedValue({
      error: "Question bank not found",
    } as never);
    const res = await loader(args("GET", "missing/questions"));
    expect(res.status).toBe(404);
  });

  it("404 for an unknown GET path", async () => {
    const res = await loader(args("GET", "bank_1/nope"));
    expect(res.status).toBe(404);
  });
});

describe("POST/PUT/DELETE /api/courses/:courseId/banks*", () => {
  it("403 when a student tries to mutate", async () => {
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: COURSE_ID, isPublished: true },
      access: { level: "student" },
    } as never);
    const res = await action(
      args("POST", undefined, { body: { name: "Midterm" } }),
    );
    expect(res.status).toBe(403);
  });

  it("creates a bank (201)", async () => {
    vi.mocked(createQuestionBank).mockResolvedValue({ bank: BANK } as never);
    const res = await action(
      args("POST", undefined, { body: { name: "Extra" } }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(BANK);
  });

  it("maps create Course not found to 404", async () => {
    vi.mocked(createQuestionBank).mockResolvedValue({
      error: "Course not found",
    } as never);
    const res = await action(
      args("POST", undefined, { body: { name: "Extra" } }),
    );
    expect(res.status).toBe(404);
  });

  it("maps create validation errors to 400", async () => {
    vi.mocked(createQuestionBank).mockResolvedValue({
      error: "Invalid input",
    } as never);
    const res = await action(
      args("POST", undefined, { body: { name: "  " } }),
    );
    expect(res.status).toBe(400);
  });

  it("updates a bank", async () => {
    vi.mocked(updateQuestionBank).mockResolvedValue({
      bank: { ...BANK, name: "Renamed" },
    } as never);
    const res = await action(
      args("PUT", "bank_1", { body: { name: "Renamed" } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: "Renamed" });
  });

  it("404 on update when the bank is missing", async () => {
    vi.mocked(updateQuestionBank).mockResolvedValue({
      error: "Question bank not found",
    } as never);
    const res = await action(
      args("PUT", "missing", { body: { name: "X" } }),
    );
    expect(res.status).toBe(404);
  });

  it("deletes a bank with an empty body", async () => {
    vi.mocked(deleteQuestionBank).mockResolvedValue({
      success: true,
    } as never);
    const res = await action({
      request: new Request(
        `http://localhost/api/courses/${COURSE_ID}/banks/bank_1`,
        { method: "DELETE" },
      ),
      params: { courseId: COURSE_ID, "*": "bank_1" },
      context: {} as never,
    } as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it("400 when deleting the default bank", async () => {
    vi.mocked(deleteQuestionBank).mockResolvedValue({
      error: "Cannot delete the default question bank",
    } as never);
    const res = await action(
      args("DELETE", "bank_1", { body: {} }),
    );
    expect(res.status).toBe(400);
  });

  it("adds a membership (201)", async () => {
    vi.mocked(addQuestionToBank).mockResolvedValue({
      membership: { id: "m1", externalQuestionId: "42" },
    } as never);
    const res = await action(
      args("POST", "bank_1/questions", {
        body: { externalQuestionId: "42", source: "question-maker" },
      }),
    );
    expect(res.status).toBe(201);
  });

  it("404 when adding to a missing bank", async () => {
    vi.mocked(addQuestionToBank).mockResolvedValue({
      error: "Question bank not found",
    } as never);
    const res = await action(
      args("POST", "missing/questions", {
        body: { externalQuestionId: "42", source: "question-maker" },
      }),
    );
    expect(res.status).toBe(404);
  });

  it("removes a membership", async () => {
    vi.mocked(removeQuestionFromBank).mockResolvedValue({
      removed: true,
      reassignedToDefault: false,
    } as never);
    const res = await action(
      args("DELETE", "bank_1/questions/42", {
        url: `http://localhost/api/courses/${COURSE_ID}/banks/bank_1/questions/42?source=question-maker`,
      }),
    );
    expect(res.status).toBe(200);
    expect(removeQuestionFromBank).toHaveBeenCalledWith(
      COURSE_ID,
      "bank_1",
      "42",
      "question-maker",
    );
  });

  it("404 when removing a non-member", async () => {
    vi.mocked(removeQuestionFromBank).mockResolvedValue({
      error: "Question is not a member of this bank",
    } as never);
    const res = await action(args("DELETE", "bank_1/questions/99"));
    expect(res.status).toBe(404);
  });

  it("405 for an unsupported method/path combo", async () => {
    const res = await action(args("PATCH", undefined, { body: {} }));
    expect(res.status).toBe(405);
  });

  it("mutates with a valid service key", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    vi.mocked(createQuestionBank).mockResolvedValue({ bank: BANK } as never);
    const res = await action(
      args("POST", undefined, { body: { name: "Extra" }, bearer: true }),
    );
    expect(requireServiceKey).toHaveBeenCalled();
    expect(res.status).toBe(201);
  });
});
