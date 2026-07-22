// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn(),
}));

vi.mock("~/lib/policy.server", () => ({
  getPolicy: vi.fn(),
  denyByPolicy: vi.fn(
    () =>
      new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
  ),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    course: { update: vi.fn() },
  },
}));

import { auth } from "~/lib/auth/server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import { getPolicy } from "~/lib/policy.server";
import prisma from "~/lib/prisma.server";
import { action } from "~/routes/api/courses.id.response-style";
import { UpdateCourseResponseStyleSchema } from "~/lib/courses/schemas";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role: "INSTRUCTOR" },
  } as never);
  vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
    course: { id: "c1" },
    access: { level: "instructor", rank: 2 },
  } as never);
  vi.mocked(prisma.course.update).mockResolvedValue({
    id: "c1",
    responseStyleTags: ["concise"],
    aiInstructions: "Be brief.",
  } as never);
});

function patchArgs(
  body: unknown,
  opts: { role?: string; courseId?: string | undefined } = {},
) {
  const role = opts.role ?? "INSTRUCTOR";
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role },
  } as never);
  return {
    request: new Request("http://localhost/api/courses/c1/response-style", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: opts.courseId === undefined ? "c1" : opts.courseId },
    context: {} as never,
  } as never;
}

describe("UpdateCourseResponseStyleSchema", () => {
  it("accepts tags-only and instructions-only (and/or contract)", () => {
    expect(
      UpdateCourseResponseStyleSchema.safeParse({
        responseStyleTags: ["concise"],
      }).success,
    ).toBe(true);
    expect(
      UpdateCourseResponseStyleSchema.safeParse({
        aiInstructions: "Use course notation.",
      }).success,
    ).toBe(true);
  });

  it("rejects an empty object", () => {
    expect(UpdateCourseResponseStyleSchema.safeParse({}).success).toBe(false);
  });
});

describe("PATCH /api/courses/:id/response-style", () => {
  it("returns 401 when anonymous", async () => {
    const args = patchArgs({ responseStyleTags: ["concise"] });
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await action(args);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a student (rank < 2)", async () => {
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: "c1" },
      access: { level: "student", rank: 1 },
    } as never);
    const res = await action(
      patchArgs({ responseStyleTags: ["concise"] }, { role: "STUDENT" }),
    );
    expect(res.status).toBe(403);
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  it("returns 403 for a TA when tas.canSetAiInstructions is off", async () => {
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: "c1" },
      access: { level: "ta", rank: 2 },
    } as never);
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await action(
      patchArgs({ responseStyleTags: ["concise"] }, { role: "TA" }),
    );
    expect(res.status).toBe(403);
    expect(getPolicy).toHaveBeenCalledWith("tas.canSetAiInstructions");
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  it("allows a TA when tas.canSetAiInstructions is on", async () => {
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: "c1" },
      access: { level: "ta", rank: 2 },
    } as never);
    vi.mocked(getPolicy).mockResolvedValue(true);
    const res = await action(
      patchArgs({ aiInstructions: "Clarify proofs." }, { role: "TA" }),
    );
    expect(res.status).toBe(200);
    expect(prisma.course.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { aiInstructions: "Clarify proofs." },
      select: {
        id: true,
        responseStyleTags: true,
        aiInstructions: true,
      },
    });
  });

  it("allows an instructor (200)", async () => {
    const res = await action(patchArgs({ responseStyleTags: ["socratic"] }));
    expect(res.status).toBe(200);
    expect(prisma.course.update).toHaveBeenCalled();
  });

  it("returns 404 when the course is missing", async () => {
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: null,
      access: null,
    } as never);
    const res = await action(patchArgs({ responseStyleTags: ["concise"] }));
    expect(res.status).toBe(404);
  });

  it("returns 422 for an empty body (and/or required)", async () => {
    const res = await action(patchArgs({}));
    expect(res.status).toBe(422);
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  it("returns 422 for an unknown tag id", async () => {
    const res = await action(patchArgs({ responseStyleTags: ["not-a-tag"] }));
    expect(res.status).toBe(422);
  });

  it("returns 405 for non-PATCH methods", async () => {
    const res = await action({
      request: new Request("http://localhost/api/courses/c1/response-style", {
        method: "GET",
      }),
      params: { id: "c1" },
      context: {} as never,
    } as never);
    expect(res.status).toBe(405);
  });
});
