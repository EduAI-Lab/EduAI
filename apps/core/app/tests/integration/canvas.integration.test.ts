// @vitest-environment node

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/canvas/client.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/canvas/client.server")>();
  return {
    ...actual,
    verifyCanvasCredentials: vi.fn().mockResolvedValue(undefined),
  };
});

import { resetCanvasRateLimitsForTests, isCanvasSyncRateLimited } from "~/lib/canvas/guards.server";
import { prepareStudentIdStorage, readStoredStudentId } from "~/lib/canvas/student-id.server";
import { loader, action } from "~/routes/api/canvas.$";
import { auth } from "~/lib/auth/server";
import { verifyCanvasCredentials, CanvasVerificationError } from "~/lib/canvas/client.server";

const TEST_ENCRYPTION_KEY = "canvas-integration-test-key!!";

let instructorId: string;
let studentId: string;
let linkedStudentId: string;
let taId: string;

function sessionFor(userId: string, role: string) {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: userId, role },
  } as never);
}

function noSession() {
  vi.mocked(auth.api.getSession).mockResolvedValue(null);
}

function makeArgs(method: string, subpath: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const args = {
    request: new Request(`http://localhost/api/canvas/${subpath}`, init),
    params: {} as Record<string, string>,
    context: {} as never,
  } as any;
  return args;
}

async function call(method: string, subpath: string, body?: unknown) {
  const args = makeArgs(method, subpath, body);
  if (method === "GET") {
    return loader(args);
  }
  return action(args);
}

beforeAll(async () => {
  vi.stubEnv("ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);

  const instructor = await prisma.user.create({
    data: {
      email: "canvas-instructor@test.com",
      name: "Canvas Instructor",
      role: "INSTRUCTOR",
      emailVerified: true,
    },
  });
  instructorId = instructor.id;

  const student = await prisma.user.create({
    data: {
      email: "canvas-student@test.com",
      name: "Canvas Student",
      role: "STUDENT",
      emailVerified: true,
    },
  });
  studentId = student.id;

  const linkedStudentPrepared = prepareStudentIdStorage("student_1");
  const linkedStudent = await prisma.user.create({
    data: {
      email: "canvas-linked-student@test.com",
      name: "Linked Student",
      role: "STUDENT",
      studentId: linkedStudentPrepared.studentId,
      studentIdLookup: linkedStudentPrepared.studentIdLookup,
      emailVerified: true,
    },
  });
  linkedStudentId = linkedStudent.id;

  const ta = await prisma.user.create({
    data: {
      email: "canvas-ta@test.com",
      name: "Canvas TA",
      role: "STUDENT",
      emailVerified: true,
    },
  });
  taId = ta.id;
});

async function cleanupCanvasSyncData() {
  const instructorCourses = await prisma.enrollment.findMany({
    where: { userId: instructorId, role: "INSTRUCTOR" },
    select: { courseId: true },
  });
  const courseIds = instructorCourses.map((enrollment) => enrollment.courseId);

  if (courseIds.length > 0) {
    await prisma.canvasRosterMember.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.enrollment.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  }
}

afterAll(async () => {
  await cleanupCanvasSyncData();
  await prisma.canvasIntegration.deleteMany({
    where: { userId: { in: [instructorId, studentId, linkedStudentId, taId] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [instructorId, studentId, linkedStudentId, taId] } },
  });
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

beforeEach(async () => {
  vi.clearAllMocks();
  resetCanvasRateLimitsForTests();
  vi.mocked(verifyCanvasCredentials).mockResolvedValue(undefined);
  await cleanupCanvasSyncData();
  await prisma.canvasIntegration.deleteMany({
    where: { userId: { in: [instructorId, studentId, linkedStudentId] } },
  });
  // Delete any transient users left behind by a previously-failed test whose
  // inline cleanup never ran (e.g. assertion failed before the delete calls).
  await prisma.user.deleteMany({
    where: {
      email: { startsWith: "canvas-", endsWith: "@test.com" },
      id: { notIn: [instructorId, studentId, linkedStudentId, taId] },
    },
  });
});

async function connectTestMode() {
  sessionFor(instructorId, "INSTRUCTOR");
  const res = await call("POST", "connect", {
    canvasUrl: "http://localhost:8080",
    isTestMode: true,
  });
  expect(res.status).toBe(200);
}

describe("Canvas API — auth", () => {
  it("returns 401 without a session", async () => {
    noSession();
    const res = await call("GET", "integration");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Unauthorized" });
  });

  it("returns 403 for STUDENT role", async () => {
    sessionFor(studentId, "STUDENT");
    const res = await call("GET", "integration");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: "Forbidden: instructors only" });
  });
});

describe("Canvas API — connect / integration / disconnect", () => {
  it("connects, returns status without apiKey, then disconnects", async () => {
    sessionFor(instructorId, "INSTRUCTOR");

    const connectRes = await call("POST", "connect", {
      canvasUrl: "http://localhost:8080",
      apiKey: "1234~test-token-secret",
    });
    expect(connectRes.status).toBe(200);
    const connectBody = await connectRes.json();
    expect(connectBody.success).toBe(true);
    expect(connectBody.data).toEqual({
      canvasUrl: "http://localhost:8080",
      isTestMode: false,
      isConnected: true,
    });
    expect(connectBody.data).not.toHaveProperty("apiKey");

    const row = await prisma.canvasIntegration.findUnique({ where: { userId: instructorId } });
    expect(row?.apiKey).toBeTruthy();
    expect(row?.apiKey).not.toBe("1234~test-token-secret");

    sessionFor(instructorId, "INSTRUCTOR");
    const getRes = await call("GET", "integration");
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.data).toEqual({
      canvasUrl: "http://localhost:8080",
      isTestMode: false,
      isConnected: true,
    });
    expect(JSON.stringify(getBody)).not.toContain("1234~test-token-secret");

    sessionFor(instructorId, "INSTRUCTOR");
    const disconnectRes = await call("DELETE", "disconnect");
    expect(disconnectRes.status).toBe(200);

    sessionFor(instructorId, "INSTRUCTOR");
    const afterRes = await call("GET", "integration");
    const afterBody = await afterRes.json();
    expect(afterBody.data).toBeNull();
    expect(afterBody.message).toBe("Canvas integration not configured");
  });

  it("allows test mode without apiKey", async () => {
    sessionFor(instructorId, "INSTRUCTOR");

    const res = await call("POST", "connect", {
      canvasUrl: "http://localhost:8080",
      isTestMode: true,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.isTestMode).toBe(true);
    expect(verifyCanvasCredentials).not.toHaveBeenCalled();
  });

  it("returns 400 when Canvas token verification fails", async () => {
    vi.mocked(verifyCanvasCredentials).mockRejectedValueOnce(
      new CanvasVerificationError("Invalid Canvas API token", 400),
    );
    sessionFor(instructorId, "INSTRUCTOR");

    const res = await call("POST", "connect", {
      canvasUrl: "http://localhost:8080",
      apiKey: "bad-token",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: "Invalid Canvas API token",
    });

    const row = await prisma.canvasIntegration.findUnique({ where: { userId: instructorId } });
    expect(row).toBeNull();
  });

  it("verifies credentials before saving in non-test mode", async () => {
    sessionFor(instructorId, "INSTRUCTOR");

    await call("POST", "connect", {
      canvasUrl: "http://localhost:8080",
      apiKey: "1234~test-token-secret",
    });

    expect(verifyCanvasCredentials).toHaveBeenCalledWith(
      "http://localhost:8080",
      "1234~test-token-secret",
    );
  });

  it("returns 400 when Canvas URL uses insecure HTTP for non-local host", async () => {
    sessionFor(instructorId, "INSTRUCTOR");

    const res = await call("POST", "connect", {
      canvasUrl: "http://canvas.ubc.ca",
      apiKey: "1234~test-token-secret",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: "Canvas URL must use HTTPS except for local development hosts",
    });
    expect(verifyCanvasCredentials).not.toHaveBeenCalled();

    const row = await prisma.canvasIntegration.findUnique({ where: { userId: instructorId } });
    expect(row).toBeNull();
  });

  it("returns 404 for unknown subpaths", async () => {
    sessionFor(instructorId, "INSTRUCTOR");
    const res = await call("GET", "unknown");
    expect(res.status).toBe(404);
  });

  it("returns 400 for non-JSON POST body", async () => {
    sessionFor(instructorId, "INSTRUCTOR");
    const res = await action({
      request: new Request("http://localhost/api/canvas/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      }),
      params: {},
      context: {} as never,
    } as any);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "Invalid JSON body" });
  });

  it("returns 200 on disconnect when no integration exists", async () => {
    sessionFor(instructorId, "INSTRUCTOR");
    const res = await call("DELETE", "disconnect");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      message: "Canvas integration disconnected",
    });
  });

  it("returns 405 for unsupported methods", async () => {
    sessionFor(instructorId, "INSTRUCTOR");
    const res = await call("PUT", "integration");
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ success: false, error: "Method not allowed" });
  });
});

describe("Canvas API — courses and sync", { timeout: 15_000 }, () => {
  it("returns 400 for courses when Canvas is not connected", async () => {
    sessionFor(instructorId, "INSTRUCTOR");
    const res = await call("GET", "courses");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "Connect Canvas first" });
  });

  it("lists mock courses with sync state in test mode", async () => {
    await connectTestMode();
    sessionFor(instructorId, "INSTRUCTOR");

    const res = await call("GET", "courses");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.courses.length).toBeGreaterThan(0);
    expect(body.data.courses[0]).toMatchObject({
      canvasId: expect.any(String),
      name: expect.any(String),
      courseCode: expect.any(String),
      isSynced: false,
      coreCourseId: null,
      lastSyncedAt: null,
    });
  });

  it("creates roster staging rows when a course is synced", async () => {
    await connectTestMode();
    sessionFor(instructorId, "INSTRUCTOR");

    await call("POST", "sync", { canvasCourseIds: ["1"] });

    const rosterRows = await prisma.canvasRosterMember.findMany({
      where: { isActive: true },
    });
    expect(rosterRows.length).toBeGreaterThan(0);
    expect(
      rosterRows.some((row) => readStoredStudentId(row.sisUserId) === "student_1"),
    ).toBe(true);
  });

  it("syncs selected courses and links enrollments by studentId", async () => {
    await connectTestMode();
    sessionFor(instructorId, "INSTRUCTOR");

    const syncRes = await call("POST", "sync", { canvasCourseIds: ["1"] });
    expect(syncRes.status).toBe(200);
    const syncBody = await syncRes.json();
    expect(syncBody.success).toBe(true);
    expect(syncBody.data.synced).toHaveLength(1);
    expect(syncBody.data.synced[0].canvasId).toBe("1");
    expect(syncBody.data.synced[0].enrollmentsLinked).toBeGreaterThanOrEqual(1);
    expect(syncBody.data.unsynced).toHaveLength(0);
    expect(syncBody.data.errors).toHaveLength(0);

    const linkedEnrollment = await prisma.enrollment.findFirst({
      where: {
        userId: linkedStudentId,
        externalSource: "canvas",
        isActive: true,
      },
      include: { course: true },
    });
    expect(linkedEnrollment).not.toBeNull();
    expect(linkedEnrollment?.course.externalId).toBe("1");

    sessionFor(instructorId, "INSTRUCTOR");
    const coursesRes = await call("GET", "courses");
    const coursesBody = await coursesRes.json();
    const syncedCourse = coursesBody.data.courses.find(
      (course: { canvasId: string }) => course.canvasId === "1",
    );
    expect(syncedCourse?.isSynced).toBe(true);
    expect(syncedCourse?.coreCourseId).toBeTruthy();
    expect(syncedCourse?.lastSyncedAt).toBeTruthy();
  });

  it("unsyncs courses omitted from the selection", async () => {
    await connectTestMode();
    sessionFor(instructorId, "INSTRUCTOR");

    await call("POST", "sync", { canvasCourseIds: ["1", "2"] });

    resetCanvasRateLimitsForTests();
    sessionFor(instructorId, "INSTRUCTOR");
    const unsyncRes = await call("POST", "sync", { canvasCourseIds: ["1"] });
    expect(unsyncRes.status).toBe(200);
    const unsyncBody = await unsyncRes.json();
    expect(unsyncBody.data.unsynced).toHaveLength(1);
    expect(unsyncBody.data.unsynced[0].canvasId).toBe("2");

    const course2 = await prisma.course.findFirst({
      where: { externalSource: "canvas", externalId: "2" },
    });
    expect(course2?.deletedAt).not.toBeNull();
  });

  it("unsyncs all previously synced courses when selection is empty", async () => {
    await connectTestMode();
    sessionFor(instructorId, "INSTRUCTOR");

    await call("POST", "sync", { canvasCourseIds: ["1"] });
    resetCanvasRateLimitsForTests();
    sessionFor(instructorId, "INSTRUCTOR");

    const unsyncRes = await call("POST", "sync", { canvasCourseIds: [] });
    expect(unsyncRes.status).toBe(200);
    const unsyncBody = await unsyncRes.json();
    expect(unsyncBody.data.unsynced).toHaveLength(1);
    expect(unsyncBody.data.unsynced[0].canvasId).toBe("1");
  });

  it("returns 400 for invalid sync payload", async () => {
    await connectTestMode();
    sessionFor(instructorId, "INSTRUCTOR");

    const res = await call("POST", "sync", { canvasCourseIds: "not-an-array" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: "Invalid input" });
  });
});

describe("Canvas API — link-roster", { timeout: 15_000 }, () => {
  async function seedSyncedCourseForLinking() {
    await connectTestMode();
    sessionFor(instructorId, "INSTRUCTOR");
    await call("POST", "sync", { canvasCourseIds: ["1"] });
  }

  it("allows a student to link enrollments by student number", async () => {
    await seedSyncedCourseForLinking();

    const unlinkedStudent = await prisma.user.create({
      data: {
        email: `canvas-unlinked-${Date.now()}@test.com`,
        name: "Unlinked Student",
        role: "STUDENT",
        emailVerified: true,
      },
    });

    try {
      sessionFor(unlinkedStudent.id, "STUDENT");
      const res = await call("POST", "link-roster", { studentNumber: "student_2" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.studentId).toBe("student_2");
      expect(body.data.enrollmentsLinked).toBeGreaterThanOrEqual(1);

      const updatedUser = await prisma.user.findUnique({
        where: { id: unlinkedStudent.id },
        select: { studentId: true },
      });
      expect(readStoredStudentId(updatedUser?.studentId)).toBe("student_2");
    } finally {
      await prisma.enrollment.deleteMany({ where: { userId: unlinkedStudent.id } });
      await prisma.user.delete({ where: { id: unlinkedStudent.id } });
    }
  });

  it("links student number even when no staged roster matches yet (#725)", async () => {
    const student = await prisma.user.create({
      data: {
        email: `canvas-no-match-${Date.now()}@test.com`,
        name: "No Match Student",
        role: "STUDENT",
        emailVerified: true,
      },
    });

    sessionFor(student.id, "STUDENT");
    const res = await call("POST", "link-roster", { studentNumber: "unknown_999" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.studentId).toBe("unknown_999");
    expect(body.data.enrollmentsLinked).toBe(0);

    await prisma.user.delete({ where: { id: student.id } });
  });

  it("returns 409 when student number is already linked to another account", async () => {
    await seedSyncedCourseForLinking();

    const otherStudent = await prisma.user.create({
      data: {
        email: `canvas-conflict-${Date.now()}@test.com`,
        name: "Conflict Student",
        role: "STUDENT",
        emailVerified: true,
      },
    });

    sessionFor(otherStudent.id, "STUDENT");
    const res = await call("POST", "link-roster", { studentNumber: "student_1" });
    expect(res.status).toBe(409);

    await prisma.user.delete({ where: { id: otherStudent.id } });
  });

  it("returns 409 when a student attempts to change their linked student number", async () => {
    await seedSyncedCourseForLinking();

    const initialNumber = `change_src_${Date.now()}`;
    const prepared = prepareStudentIdStorage(initialNumber);
    const student = await prisma.user.create({
      data: {
        email: `canvas-change-${Date.now()}@test.com`,
        name: "Change Student",
        role: "STUDENT",
        emailVerified: true,
        studentId: prepared.studentId,
        studentIdLookup: prepared.studentIdLookup,
      },
    });

    sessionFor(student.id, "STUDENT");
    const res = await call("POST", "link-roster", { studentNumber: "student_2" });
    expect(res.status).toBe(409);

    const updatedUser = await prisma.user.findUnique({
      where: { id: student.id },
      select: { studentId: true },
    });
    expect(readStoredStudentId(updatedUser?.studentId)).toBe(initialNumber);

    await prisma.enrollment.deleteMany({ where: { userId: student.id } });
    await prisma.user.delete({ where: { id: student.id } });
  });

  it("returns 401 for unauthenticated link-roster requests", async () => {
    noSession();
    const res = await call("POST", "link-roster", { studentNumber: "student_1" });
    expect(res.status).toBe(401);
  });

  it("allows a TA to link enrollments by student number", async () => {
    await seedSyncedCourseForLinking();

    const unlinkedTa = await prisma.user.create({
      data: {
        email: `canvas-unlinked-ta-${Date.now()}@test.com`,
        name: "Unlinked TA",
        role: "STUDENT",
        emailVerified: true,
      },
    });

    try {
      // A TA is a STUDENT at the platform level; TA-ness is the Enrollment role.
      sessionFor(unlinkedTa.id, "STUDENT");
      const res = await call("POST", "link-roster", { studentNumber: "student_2" });
      expect(res.status).toBe(200);
    } finally {
      await prisma.enrollment.deleteMany({ where: { userId: unlinkedTa.id } });
      await prisma.user.delete({ where: { id: unlinkedTa.id } });
    }
  });

  it("returns 403 when an instructor attempts link-roster", async () => {
    sessionFor(instructorId, "INSTRUCTOR");
    const res = await call("POST", "link-roster", { studentNumber: "student_1" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      success: false,
      error: "Forbidden: students and TAs only",
    });
  });
});

describe("Canvas API — sync guards", () => {
  it("returns 403 when syncing a course not taught by the instructor", async () => {
    await connectTestMode();
    sessionFor(instructorId, "INSTRUCTOR");

    const res = await call("POST", "sync", { canvasCourseIds: ["99999"] });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.invalidCourseIds).toEqual(["99999"]);
  });

  it("returns 429 when sync is requested too frequently", async () => {
    await connectTestMode();
    sessionFor(instructorId, "INSTRUCTOR");

    // Prime the in-memory limiter without running a full sync (keeps the test fast).
    isCanvasSyncRateLimited(instructorId);

    const res = await call("POST", "sync", { canvasCourseIds: ["1"] });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      success: false,
      error: expect.stringMatching(/too recently/i),
    });
  });
});
