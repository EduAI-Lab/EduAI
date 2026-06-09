/**
 * Shared RBAC test fixtures (#292 family).
 *
 * Integration usage: the test file must mock the auth module BEFORE importing
 * route handlers (the standard pattern in app/tests/integration):
 *
 *   vi.mock("~/lib/auth/server", () => ({ auth: { api: { getSession: vi.fn() } } }));
 *
 * Then seed real rows with seedUser/seedCourse/enroll and drive the role ×
 * route matrix with `it.each`, calling `mockSession(user)` per case.
 */
import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import type { EnrollmentRole, UserRole } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";

export type SeededUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  authorizedUnits: string[];
};

export async function seedUser(opts: {
  role?: UserRole;
  authorizedUnits?: string[];
  name?: string;
} = {}): Promise<SeededUser> {
  const role = opts.role ?? "STUDENT";
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `rbac-${role.toLowerCase()}-${suffix}@test.local`,
      name: opts.name ?? `RBAC ${role} ${suffix}`,
      role,
      authorizedUnits: opts.authorizedUnits ?? [],
      emailVerified: false,
    },
  });
  return user as SeededUser;
}

export async function seedCourse(opts: {
  department?: string | null;
  isPublished?: boolean;
  name?: string;
  deletedAt?: Date | null;
} = {}) {
  const suffix = randomUUID().slice(0, 8);
  return prisma.course.create({
    data: {
      name: opts.name ?? `RBAC Course ${suffix}`,
      code: `RBC ${suffix}`,
      section: "001",
      term: "Fall",
      year: 2026,
      startDate: new Date("2026-09-01"),
      department: opts.department ?? null,
      isPublished: opts.isPublished ?? true,
      deletedAt: opts.deletedAt ?? null,
    },
  });
}

export async function enroll(
  courseId: string,
  userId: string,
  role: EnrollmentRole,
  isActive = true,
) {
  return prisma.enrollment.create({
    data: { courseId, userId, role, isActive },
  });
}

/** Point the mocked better-auth getSession at a user (or null for anonymous). */
export function mockSession(user: { id: string; role: string } | null) {
  vi.mocked(auth.api.getSession).mockResolvedValue(
    (user ? { user } : null) as never,
  );
}

/** Delete seeded rows (enrollments cascade off users/courses are NOT automatic — pass everything). */
export async function cleanupRbac(opts: { userIds?: string[]; courseIds?: string[] }) {
  const { userIds = [], courseIds = [] } = opts;
  await prisma.enrollment.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { courseId: { in: courseIds } }] },
  });
  await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
