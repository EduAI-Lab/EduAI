// @vitest-environment node
//
// #1842/#1811 — a soft-deleted course must not own its (code, section, year, term)
// slot forever, and re-creating it offers a restore first. Uses the test database
// configured in apps/core/.env.test.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import prisma from "~/lib/prisma.server";
import { seedTestDisciplines } from "../helpers/disciplines";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { createCourse, deleteCourse, updateCourse } from "~/lib/courses/server";
import { auth } from "~/lib/auth/server";

const START_DATE = "2026-09-01";

let adminId: string;
let instructorId: string;
let otherInstructorId: string;
let studentId: string;
const createdCourseIds: string[] = [];

const ADMIN_SESSION = { user: { id: "", role: "ADMIN", email: "", name: "Soft Delete Admin" } };

type SessionUser = { id: string; role: string; authorizedUnits?: string[] };

function makeCreateRequest(fields: Record<string, string | number>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, String(value));
  return new Request("http://localhost/api/courses", { method: "POST", body: formData });
}

/** The create payload for one course identity — same code/section/term each time. */
function coursePayload(code: string, overrides: Record<string, string | number> = {}) {
  return {
    name: `Soft delete ${code}`,
    code,
    section: "001",
    term: "W1",
    year: 2026,
    startDate: START_DATE,
    department: "COSC",
    instructorUserIds: instructorId,
    ...overrides,
  };
}

async function createCourseAs(
  fields: Record<string, string | number>,
  user: SessionUser = ADMIN_SESSION.user,
) {
  vi.mocked(auth.api.getSession).mockResolvedValue({ user } as never);
  const res = await createCourse(makeCreateRequest(fields));
  const body = await res.clone().json();
  if (res.status === 201) createdCourseIds.push(body.id);
  return { status: res.status, body };
}

async function softDelete(courseId: string) {
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: ADMIN_SESSION.user } as never);
  const res = await deleteCourse(
    new Request(`http://localhost/api/courses/${courseId}`, { method: "DELETE" }),
    courseId,
  );
  expect(res.status).toBe(204);
}

async function createUser(
  prefix: string,
  role: "ADMIN" | "INSTRUCTOR" | "STUDENT",
  suffix: string,
) {
  return prisma.user.create({
    data: { email: `${prefix}-${suffix}@ubc.ca`, name: prefix, role, emailVerified: false },
  });
}

beforeAll(async () => {
  await seedTestDisciplines();
  const suffix = randomUUID().slice(0, 8);
  const admin = await createUser("soft-delete-admin", "ADMIN", suffix);
  adminId = admin.id;
  ADMIN_SESSION.user.id = adminId;
  ADMIN_SESSION.user.email = admin.email;

  instructorId = (await createUser("soft-delete-instructor", "INSTRUCTOR", suffix)).id;
  otherInstructorId = (await createUser("soft-delete-other", "INSTRUCTOR", suffix)).id;
  studentId = (await createUser("soft-delete-student", "STUDENT", suffix)).id;
});

afterAll(async () => {
  if (createdCourseIds.length > 0) {
    await prisma.enrollment.deleteMany({ where: { courseId: { in: createdCourseIds } } });
    await prisma.questionBank.deleteMany({ where: { courseId: { in: createdCourseIds } } });
    await prisma.courseTopic.deleteMany({ where: { courseId: { in: createdCourseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
  }
  await prisma.user.deleteMany({
    where: { id: { in: [adminId, instructorId, otherInstructorId, studentId] } },
  });
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("#1842/#1811 — soft-deleted courses and the (code, section, year, term) slot", () => {
  it("warns about a soft-deleted copy, then creates a new row only when told to", async () => {
    const code = `SD ${randomUUID().slice(0, 6)}`;

    const first = await createCourseAs(coursePayload(code));
    expect(first.status).toBe(201);
    await softDelete(first.body.id);

    // #1811: the instructor hears about the deleted copy before a second row exists.
    const warned = await createCourseAs(coursePayload(code, { name: `Soft delete ${code} v2` }));
    expect(warned.status).toBe(409);
    expect(warned.body.error).toBe("COURSE_POSSIBLE_DUPLICATE");
    expect(warned.body.deletedMatches).toEqual([
      expect.objectContaining({ id: first.body.id, canRestore: true }),
    ]);

    const second = await createCourseAs(
      coursePayload(code, { name: `Soft delete ${code} v2`, duplicateResolution: "create" }),
    );
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);

    // The tombstone is untouched — creating anyway must not resurrect or rewrite it.
    const afterRecreate = await prisma.course.findUnique({ where: { id: first.body.id } });
    expect(afterRecreate?.deletedAt).toBeInstanceOf(Date);
    expect(afterRecreate?.name).toBe(`Soft delete ${code}`);
  });

  it("restores the soft-deleted course in place, keeping its enrollments", async () => {
    const code = `SD ${randomUUID().slice(0, 6)}`;

    const first = await createCourseAs(coursePayload(code));
    expect(first.status).toBe(201);
    await prisma.enrollment.create({
      data: { courseId: first.body.id, userId: studentId, role: "STUDENT", isActive: true },
    });
    await softDelete(first.body.id);

    const restored = await createCourseAs(
      coursePayload(code, {
        name: `Restored ${code}`,
        duplicateResolution: "restore",
        restoreCourseId: first.body.id,
      }),
    );
    expect(restored.status).toBe(200);
    expect(restored.body.id).toBe(first.body.id);

    const row = await prisma.course.findUnique({
      where: { id: first.body.id },
      include: { enrollments: true },
    });
    expect(row?.deletedAt).toBeNull();
    expect(row?.name).toBe(`Restored ${code}`);
    expect(row?.enrollments.map((e) => e.userId).sort()).toEqual([instructorId, studentId].sort());
    expect(await prisma.course.count({ where: { code } })).toBe(1);
  });

  it("refuses a restore by someone with no claim on the deleted course", async () => {
    const code = `SD ${randomUUID().slice(0, 6)}`;
    const first = await createCourseAs(coursePayload(code));
    expect(first.status).toBe(201);
    await softDelete(first.body.id);

    // A MATH unit admin re-creating a deleted COSC course they never taught.
    const outsider: SessionUser = {
      id: otherInstructorId,
      role: "UNIT_ADMIN",
      authorizedUnits: ["MATH"],
    };
    const asOutsider = { department: "MATH", instructorUserIds: otherInstructorId };

    const restore = await createCourseAs(
      coursePayload(code, {
        ...asOutsider,
        duplicateResolution: "restore",
        restoreCourseId: first.body.id,
      }),
      outsider,
    );
    expect(restore.status).toBe(403);

    // Nor do they hear about it: the deleted course is outside their scope, so creation goes through.
    const created = await createCourseAs(coursePayload(code, asOutsider), outsider);
    expect(created.status).toBe(201);
    expect(created.body.id).not.toBe(first.body.id);
  });

  it("refuses a restore by an instructor whose enrollment was deactivated", async () => {
    const code = `SD ${randomUUID().slice(0, 6)}`;
    const first = await createCourseAs(coursePayload(code));
    expect(first.status).toBe(201);
    await prisma.enrollment.updateMany({
      where: { courseId: first.body.id, userId: instructorId },
      data: { isActive: false },
    });
    await softDelete(first.body.id);

    const removed: SessionUser = { id: instructorId, role: "INSTRUCTOR" };
    const warned = await createCourseAs(coursePayload(code), removed);
    expect(warned.status).toBe(409);
    expect(warned.body.deletedMatches).toEqual([
      expect.objectContaining({ id: first.body.id, canRestore: false }),
    ]);

    const restore = await createCourseAs(
      coursePayload(code, { duplicateResolution: "restore", restoreCourseId: first.body.id }),
      removed,
    );
    expect(restore.status).toBe(403);
  });

  it("keeps the stored department when an instructor restores", async () => {
    const code = `SD ${randomUUID().slice(0, 6)}`;
    const first = await createCourseAs(coursePayload(code));
    expect(first.status).toBe(201);
    await softDelete(first.body.id);

    const restored = await createCourseAs(
      coursePayload(code, {
        department: "MATH",
        duplicateResolution: "restore",
        restoreCourseId: first.body.id,
      }),
      { id: instructorId, role: "INSTRUCTOR" },
    );
    expect(restored.status).toBe(200);
    const row = await prisma.course.findUnique({ where: { id: first.body.id } });
    expect(row?.department).toBe("COSC");
  });

  it("warns when the same instructor already teaches the course in another section", async () => {
    const code = `SD ${randomUUID().slice(0, 6)}`;
    expect((await createCourseAs(coursePayload(code))).status).toBe(201);

    const warned = await createCourseAs(coursePayload(code, { section: "002" }));
    expect(warned.status).toBe(409);
    expect(warned.body.error).toBe("COURSE_POSSIBLE_DUPLICATE");
    expect(warned.body.deletedMatches).toEqual([]);
    expect(warned.body.similarCourses).toEqual([expect.objectContaining({ code, section: "001" })]);

    // Another instructor's section is not this instructor's near-duplicate.
    const other = await createCourseAs(
      coursePayload(code, { section: "003", instructorUserIds: otherInstructorId }),
    );
    expect(other.status).toBe(201);

    const confirmed = await createCourseAs(
      coursePayload(code, { section: "002", duplicateResolution: "create" }),
    );
    expect(confirmed.status).toBe(201);
  });

  it("rejects a second LIVE course in the same term even with a different start date", async () => {
    const code = `SD ${randomUUID().slice(0, 6)}`;

    const first = await createCourseAs(coursePayload(code));
    expect(first.status).toBe(201);

    const duplicate = await createCourseAs(
      coursePayload(code, { name: `Duplicate ${code}`, startDate: "2026-09-15" }),
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe("COURSE_IDENTITY_TAKEN");
    expect(duplicate.body.fields?.code).toContain(code);
  });

  it("rejects an edit that moves a course onto a live course's identity", async () => {
    const code = `SD ${randomUUID().slice(0, 6)}`;
    expect((await createCourseAs(coursePayload(code))).status).toBe(201);
    const second = await createCourseAs(
      coursePayload(code, { section: "002", duplicateResolution: "create" }),
    );
    expect(second.status).toBe(201);

    vi.mocked(auth.api.getSession).mockResolvedValue({ user: ADMIN_SESSION.user } as never);
    const res = await updateCourse(
      new Request(`http://localhost/api/courses/${second.body.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "001" }),
      }),
      second.body.id,
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("COURSE_IDENTITY_TAKEN");
  });

  it("keeps the partial unique index enforced between two live rows at the database level", async () => {
    const code = `SD ${randomUUID().slice(0, 6)}`;
    const base = {
      code,
      name: `Raw ${code}`,
      section: "001",
      term: "W1",
      year: 2026,
      startDate: new Date(START_DATE),
    };

    const live = await prisma.course.create({ data: base });
    createdCourseIds.push(live.id);

    // Same term identity, different start date — still the same course.
    await expect(
      prisma.course.create({ data: { ...base, startDate: new Date("2026-09-15") } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("lets two live Canvas shells share a code in one term", async () => {
    // The Canvas import hardcodes section "001"; its rows are keyed by external identity.
    const code = `SD ${randomUUID().slice(0, 6)}`;
    const base = {
      code,
      section: "001",
      term: "W1",
      year: 2026,
      externalSource: "canvas",
    };
    for (const [externalId, startDate] of [
      [randomUUID(), "2026-09-01"],
      [randomUUID(), "2026-09-08"],
    ]) {
      const row = await prisma.course.create({
        data: { ...base, name: `Canvas ${code}`, externalId, startDate: new Date(startDate) },
      });
      createdCourseIds.push(row.id);
    }
    expect(await prisma.course.count({ where: { code, deletedAt: null } })).toBe(2);
  });

  it("declares the slot index as partial on deletedAt so tombstones do not hold it", async () => {
    // Prisma cannot express a partial unique index, so it lives in a raw
    // migration and is re-applied to the integration database by globalSetup.
    // If a future `prisma migrate dev` drifts it back to a total unique index,
    // this fails rather than silently re-breaking re-creation.
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'courses' AND indexname = 'courses_code_section_year_term_active_key'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/UNIQUE INDEX/i);
    expect(rows[0].indexdef).toMatch(/"deletedAt" IS NULL/i);
    expect(rows[0].indexdef).toMatch(/"externalSource" IS NULL/i);

    // The superseded startDate-keyed indexes must be gone, or they still own a slot.
    const legacy = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'courses' AND indexname IN (
        'courses_code_startDate_section_key',
        'courses_code_startDate_section_active_key'
      )
    `;
    expect(legacy).toHaveLength(0);
  });

  it("leaves the external-identity unique index total, so a re-import restores rather than duplicates", async () => {
    // #1842 asked whether externalSource/externalId has the same gap. It does
    // not: upsertCoreCourseFromCanvas upserts ON this key and clears deletedAt,
    // so a soft-deleted Canvas course is restored in place — keeping its
    // materials, chunks and embeddings. Making this index partial would hide
    // the tombstone from that upsert and fork a second empty course instead.
    // See canvas-course-identity.integration.test.ts for the restore itself.
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'courses' AND indexname = 'courses_externalSource_externalId_key'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).not.toMatch(/WHERE/i);
  });
});
