// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

// `addEnrollment` is stubbed (it owns its own DB access and is tested in
// enrollments.server.test.ts); `canAddEnrollmentRole` stays REAL so this file
// exercises the actual rank rule rather than a copy of it.
vi.mock("~/lib/courses/enrollments.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/courses/enrollments.server")>();
  return { ...actual, addEnrollment: vi.fn() };
});

import { importEnrollmentRows, parseEnrollmentCsv } from "~/lib/courses/enrollments-csv.server";
import { addEnrollment } from "~/lib/courses/enrollments.server";

const addEnrollmentMock = vi.mocked(addEnrollment);

/** `addEnrollment` succeeds for every row unless a test says otherwise. */
function resolveAllCreated() {
  let n = 0;
  addEnrollmentMock.mockImplementation(async (_courseId, payload) => {
    n += 1;
    return {
      status: "201",
      enrollment: { id: `enr-${n}`, userId: String(payload.userId), role: payload.role },
    } as Awaited<ReturnType<typeof addEnrollment>>;
  });
}

function mockUsers(emails: string[]) {
  prismaMock.user.findMany.mockResolvedValue(
    emails.map((email, i) => ({ id: `user-${i + 1}`, email })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("importEnrollmentRows — privilege must not widen over the single-add path", () => {
  it("lets an INSTRUCTOR (rank 2) bulk-add STUDENT and TA but not INSTRUCTOR", async () => {
    mockUsers(["stu@test.edu", "ta@test.edu", "boss@test.edu"]);
    resolveAllCreated();

    const summary = await importEnrollmentRows(
      "course-1",
      [
        { line: 2, email: "stu@test.edu", role: "STUDENT" },
        { line: 3, email: "ta@test.edu", role: "TA" },
        { line: 4, email: "boss@test.edu", role: "INSTRUCTOR" },
      ],
      [],
      2,
    );

    expect(summary.imported).toBe(2);
    expect(summary.errors).toEqual([
      {
        line: 4,
        email: "boss@test.edu",
        code: "FORBIDDEN_ROLE",
        message: expect.stringContaining("INSTRUCTOR"),
      },
    ]);
    // The rejected row must never reach the write path at all.
    expect(addEnrollmentMock).toHaveBeenCalledTimes(2);
    expect(addEnrollmentMock.mock.calls.map((call) => call[1].role)).toEqual(["STUDENT", "TA"]);
    // …and it must not have been looked up either.
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: { in: ["stu@test.edu", "ta@test.edu"] } } }),
    );
  });

  it("lets an ADMIN (rank 4) bulk-add an INSTRUCTOR row", async () => {
    mockUsers(["boss@test.edu"]);
    resolveAllCreated();

    const summary = await importEnrollmentRows(
      "course-1",
      [{ line: 2, email: "boss@test.edu", role: "INSTRUCTOR" }],
      [],
      4,
    );

    expect(summary).toMatchObject({ imported: 1, failed: 0 });
    expect(addEnrollmentMock).toHaveBeenCalledWith(
      "course-1",
      { userId: "user-1", role: "INSTRUCTOR" },
      4,
    );
  });

  it("passes the caller's rank through to addEnrollment so its own guard still runs", async () => {
    mockUsers(["stu@test.edu"]);
    addEnrollmentMock.mockResolvedValue({ status: "403", error: "Forbidden" } as Awaited<
      ReturnType<typeof addEnrollment>
    >);

    const summary = await importEnrollmentRows(
      "course-1",
      [{ line: 2, email: "stu@test.edu", role: "STUDENT" }],
      [],
      2,
    );

    expect(summary.imported).toBe(0);
    expect(summary.errors[0].code).toBe("FORBIDDEN_ROLE");
  });
});

describe("importEnrollmentRows — per-row outcomes", () => {
  it("reports an email with no EduAI account without aborting the batch", async () => {
    mockUsers(["known@test.edu"]);
    resolveAllCreated();

    const summary = await importEnrollmentRows(
      "course-1",
      [
        { line: 2, email: "known@test.edu", role: "STUDENT" },
        { line: 3, email: "ghost@test.edu", role: "STUDENT" },
      ],
      [],
      2,
    );

    expect(summary.imported).toBe(1);
    expect(summary.errors).toEqual([
      { line: 3, email: "ghost@test.edu", code: "USER_NOT_FOUND", message: expect.any(String) },
    ]);
  });

  it("counts an already-active enrollment as a skip, not a failure (re-upload is safe)", async () => {
    mockUsers(["stu@test.edu"]);
    addEnrollmentMock.mockResolvedValue({ status: "409", error: "ALREADY_ENROLLED" } as Awaited<
      ReturnType<typeof addEnrollment>
    >);

    const summary = await importEnrollmentRows(
      "course-1",
      [{ line: 2, email: "stu@test.edu", role: "STUDENT" }],
      [],
      2,
    );

    expect(summary).toMatchObject({ imported: 0, alreadyEnrolled: 1, failed: 0 });
    expect(summary.errors).toEqual([]);
  });

  it("merges parse errors with import errors and orders them by line number", async () => {
    mockUsers(["stu@test.edu"]);
    resolveAllCreated();

    const summary = await importEnrollmentRows(
      "course-1",
      [{ line: 5, email: "stu@test.edu", role: "STUDENT" }],
      [{ line: 3, email: "nope", code: "INVALID_EMAIL", message: "bad" }],
      2,
    );

    expect(summary.totalRows).toBe(2);
    expect(summary.errors.map((e) => e.line)).toEqual([3]);
    expect(summary.imported).toBe(1);
  });

  it("returns the created enrollments so the caller can audit-log each one", async () => {
    mockUsers(["stu@test.edu"]);
    resolveAllCreated();

    const summary = await importEnrollmentRows(
      "course-1",
      [{ line: 2, email: "stu@test.edu", role: "STUDENT" }],
      [],
      2,
    );

    expect(summary.created).toEqual([
      { enrollmentId: "enr-1", userId: "user-1", email: "stu@test.edu", role: "STUDENT" },
    ]);
  });

  it("skips the user lookup entirely when nothing is importable", async () => {
    const summary = await importEnrollmentRows("course-1", [], [], 2);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ totalRows: 0, imported: 0, failed: 0 });
  });
});

describe("parse + import end to end", () => {
  it("imports 97 rows and reports 3 failures from a 100-row file", async () => {
    const lines = ["email"];
    const goodEmails: string[] = [];
    for (let i = 1; i <= 100; i += 1) {
      if (i === 10 || i === 50 || i === 90) {
        lines.push("not-an-email");
      } else {
        lines.push(`student${i}@test.edu`);
        goodEmails.push(`student${i}@test.edu`);
      }
    }
    mockUsers(goodEmails);
    resolveAllCreated();

    const parsed = parseEnrollmentCsv(lines.join("\r\n"));
    if (!parsed.ok) throw new Error(parsed.error);
    const summary = await importEnrollmentRows("course-1", parsed.rows, parsed.errors, 2);

    expect(summary.totalRows).toBe(100);
    expect(summary.imported).toBe(97);
    expect(summary.failed).toBe(3);
    expect(summary.errors.map((e) => e.line)).toEqual([11, 51, 91]);
    expect(addEnrollmentMock).toHaveBeenCalledTimes(97);
  });
});
