// @vitest-environment node

import { beforeAll, describe, expect, it } from "vitest";
import prisma from "~/lib/prisma.server";
import {
  CanvasApiError,
  downloadCanvasFile,
  getCanvasCourseWithTerm,
  listCanvasCourseFiles,
  listCanvasCourseModules,
  listCanvasCourseStudents,
  listCanvasCourseTas,
  listTeacherCanvasCourses,
  verifyCanvasCredentials,
} from "~/lib/canvas/client.server";
import { saveCanvasIntegration } from "~/lib/canvas/integration.server";
import { syncCanvasCourses } from "~/lib/canvas/sync.server";
import { EnrollmentRole } from "@prisma/client";
import {
  CanvasLiveConfigError,
  assertApprovedTeacherCourse,
  loadCanvasLiveConfig,
  redactCanvasLiveSecrets,
} from "./canvas-live.config";

const config = loadCanvasLiveConfig();

function requireConfig() {
  if (!config.enabled) throw new Error(config.reason);
  return config;
}

async function capability<T>(name: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected failure";
    throw new Error(`[Canvas live] ${name}: ${redactCanvasLiveSecrets(message, config.enabled ? config.token : undefined)}`);
  }
}

describe("Canvas live integration — approved UBC sandbox", { timeout: 180_000 }, () => {
  const canvas = requireConfig();

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = canvas.encryptionKey;
    const user = await prisma.user.findUnique({
      where: { id: canvas.coreUserId },
      select: { id: true, role: true },
    });
    if (!user || user.role !== "INSTRUCTOR") {
      throw new CanvasLiveConfigError("CANVAS_LIVE_CORE_USER_ID must identify an existing instructor");
    }
  });

  it("authenticates the token with the Canvas profile endpoint", async () => {
    await capability("profile authentication", () =>
      verifyCanvasCredentials(canvas.baseUrl, canvas.token),
    );
  });

  it("finds the approved course in the token owner's teacher course list", async () => {
    const courses = await capability("teacher course list", () =>
      listTeacherCanvasCourses({ canvasUrl: canvas.baseUrl, apiKey: canvas.token, isTestMode: false }),
    );
    assertApprovedTeacherCourse(
      courses.map((course) => String(course.id)),
      canvas.courseId,
    );
  });

  it("reads course details, term dates, roster, files, modules, and an approved download", async () => {
    const credentials = { canvasUrl: canvas.baseUrl, apiKey: canvas.token, isTestMode: false };
    const course = await capability("course details and term dates", () =>
      getCanvasCourseWithTerm(credentials, canvas.courseId),
    );
    expect(course).not.toBeNull();
    expect(course?.course_code).toBe("SB.EduAI");
    expect(course?.term).not.toBeNull();
    expect(course?.term?.start_at || course?.start_at).toBeTruthy();
    expect(course?.term?.end_at || course?.end_at).toBeTruthy();

    const [students, tas, files, modules] = await Promise.all([
      capability("student roster", () => listCanvasCourseStudents(credentials, canvas.courseId)),
      capability("TA roster", () => listCanvasCourseTas(credentials, canvas.courseId)),
      capability("course files", () => listCanvasCourseFiles(credentials, canvas.courseId)),
      capability("course modules and items", () => listCanvasCourseModules(credentials, canvas.courseId)),
    ]);
    expect(Array.isArray(students)).toBe(true);
    expect(Array.isArray(tas)).toBe(true);
    expect(Array.isArray(files)).toBe(true);
    expect(Array.isArray(modules)).toBe(true);

    const approvedFile = files.find((file) => String(file.id) === canvas.approvedFileId);
    if (!approvedFile) {
      throw new Error(`[Canvas live] approved file ${canvas.approvedFileId} was not found in course ${canvas.courseId}`);
    }
    const bytes = await capability("approved file download", () =>
      downloadCanvasFile(credentials, approvedFile),
    );
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("runs the EduAI course sync twice without duplicate courses or enrollments", async () => {
    await capability("save live Canvas integration", () =>
      saveCanvasIntegration(canvas.coreUserId, {
        canvasUrl: canvas.baseUrl,
        apiKey: canvas.token,
        isTestMode: false,
      }),
    );

    const first = await capability("first Core course sync", () =>
      syncCanvasCourses(canvas.coreUserId, [canvas.courseId]),
    );
    expect(first.errors).toEqual([]);
    expect(first.synced).toHaveLength(1);
    expect(first.synced[0]?.canvasId).toBe(canvas.courseId);

    const second = await capability("repeated Core course sync", () =>
      syncCanvasCourses(canvas.coreUserId, [canvas.courseId]),
    );
    expect(second.errors).toEqual([]);
    expect(second.synced).toHaveLength(1);

    const courses = await prisma.course.findMany({
      where: { externalSource: "canvas", externalId: canvas.courseId },
      select: { id: true, isActive: true, deletedAt: true },
    });
    expect(courses).toHaveLength(1);
    expect(courses[0]?.isActive).toBe(true);
    expect(courses[0]?.deletedAt).toBeNull();

    const instructorEnrollments = await prisma.enrollment.findMany({
      where: {
        courseId: courses[0]?.id,
        userId: canvas.coreUserId,
        role: EnrollmentRole.INSTRUCTOR,
        isActive: true,
      },
    });
    expect(instructorEnrollments).toHaveLength(1);

    const stagedRoster = await prisma.canvasRosterMember.count({
      where: { courseId: courses[0]?.id, isActive: true },
    });
    expect(stagedRoster).toBeGreaterThanOrEqual(0);

    const allCourseEnrollments = await prisma.enrollment.count({ where: { courseId: courses[0]?.id } });
    const repeatedCourseEnrollments = await prisma.enrollment.count({
      where: { courseId: courses[0]?.id, externalSource: "canvas" },
    });
    expect(allCourseEnrollments).toBeGreaterThanOrEqual(1);
    expect(repeatedCourseEnrollments).toBeGreaterThanOrEqual(1);
  });

  it("does not expose token material when a capability fails", async () => {
    const error = new CanvasApiError(`request failed for ${canvas.token}`, 500);
    expect(redactCanvasLiveSecrets(error.message, canvas.token)).not.toContain(canvas.token);
    expect(redactCanvasLiveSecrets("Authorization: Bearer secret-value", canvas.token)).toContain("[REDACTED]");
  });
});
