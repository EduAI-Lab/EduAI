// @vitest-environment node
//
// #1842 — a soft-deleted course must not own its (code, startDate, section)
// uniqueness slot forever. Uses the test database configured in
// apps/core/.env.test.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import prisma from "~/lib/prisma.server";
import { seedTestDisciplines } from "../helpers/disciplines";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { createCourse, deleteCourse } from "~/lib/courses/server";
import { auth } from "~/lib/auth/server";

const START_DATE = "2026-09-01";

let adminId: string;
let instructorId: string;
const createdCourseIds: string[] = [];

const ADMIN_SESSION = { user: { id: "", role: "ADMIN", email: "", name: "Soft Delete Admin" } };

function makeCreateRequest(fields: Record<string, string | number>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, String(value));
  return new Request("http://localhost/api/courses", { method: "POST", body: formData });
}

/** The create payload for one course identity — same code/section/start date each time. */
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

async function createCourseAs(fields: Record<string, string | number>) {
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: ADMIN_SESSION.user } as never);
  const res = await createCourse(makeCreateRequest(fields));
  const body = await res.clone().json();
  if (res.status === 201) createdCourseIds.push(body.id);
  return { status: res.status, body };
}

beforeAll(async () => {
  await seedTestDisciplines();
  const suffix = randomUUID().slice(0, 8);
  const admin = await prisma.user.create({
    data: {
      email: `soft-delete-admin-${suffix}@ubc.ca`,
      name: "Soft Delete Admin",
      role: "ADMIN",
      emailVerified: false,
    },
  });
  adminId = admin.id;
  ADMIN_SESSION.user.id = adminId;
  ADMIN_SESSION.user.email = admin.email;

  const instructor = await prisma.user.create({
    data: {
      email: `soft-delete-instructor-${suffix}@ubc.ca`,
      name: "Soft Delete Instructor",
      role: "INSTRUCTOR",
      emailVerified: false,
    },
  });
  instructorId = instructor.id;
});

afterAll(async () => {
  if (createdCourseIds.length > 0) {
    await prisma.enrollment.deleteMany({ where: { courseId: { in: createdCourseIds } } });
    await prisma.questionBank.deleteMany({ where: { courseId: { in: createdCourseIds } } });
    await prisma.courseTopic.deleteMany({ where: { courseId: { in: createdCourseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [adminId, instructorId] } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("#1842 — soft-deleted courses and the (code, startDate, section) slot", () => {
  it("permits re-creating a course at the same code + section + start date after a soft delete", async () => {
    const code = `SD ${randomUUID().slice(0, 6)}`;

    const first = await createCourseAs(coursePayload(code));
    expect(first.status).toBe(201);

    vi.mocked(auth.api.getSession).mockResolvedValue({ user: ADMIN_SESSION.user } as never);
    const deleteRes = await deleteCourse(
      new Request(`http://localhost/api/courses/${first.body.id}`, { method: "DELETE" }),
      first.body.id,
    );
    expect(deleteRes.status).toBe(204);

    const tombstone = await prisma.course.findUnique({ where: { id: first.body.id } });
    expect(tombstone?.deletedAt).toBeInstanceOf(Date);

    // The slot is free again: the same identity may be re-created as a new row.
    const second = await createCourseAs(coursePayload(code, { name: `Soft delete ${code} v2` }));
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);

    // The tombstone is untouched — re-creation must not resurrect or rewrite it.
    const afterRecreate = await prisma.course.findUnique({ where: { id: first.body.id } });
    expect(afterRecreate?.deletedAt).toBeInstanceOf(Date);
    expect(afterRecreate?.name).toBe(`Soft delete ${code}`);
  });

  it("still rejects a second LIVE course at the same code + section + start date, naming the conflict", async () => {
    const code = `SD ${randomUUID().slice(0, 6)}`;

    const first = await createCourseAs(coursePayload(code));
    expect(first.status).toBe(201);

    // Previously an unhandled P2002 escaped as a 500 with no usable message.
    const duplicate = await createCourseAs(coursePayload(code, { name: `Duplicate ${code}` }));
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe("COURSE_IDENTITY_TAKEN");
    expect(duplicate.body.fields?.code).toContain(code);
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

    await expect(prisma.course.create({ data: base })).rejects.toMatchObject({ code: "P2002" });
  });

  it("declares the slot index as partial on deletedAt so tombstones do not hold it", async () => {
    // Prisma cannot express a partial unique index, so it lives in a raw
    // migration and is re-applied to the integration database by globalSetup.
    // If a future `prisma migrate dev` drifts it back to a total unique index,
    // this fails rather than silently re-breaking re-creation.
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'courses' AND indexname = 'courses_code_startDate_section_active_key'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/UNIQUE INDEX/i);
    expect(rows[0].indexdef).toMatch(/WHERE \("deletedAt" IS NULL\)/i);

    // The superseded total unique index must be gone, or it still owns the slot.
    const legacy = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'courses' AND indexname = 'courses_code_startDate_section_key'
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
