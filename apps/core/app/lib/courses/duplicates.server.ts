/**
 * #1811: course identity is code + section + year + term. Before inserting,
 * createCourse warns about soft-deleted copies (which can be restored) and
 * near-duplicates the same instructor already teaches.
 */
import type { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { getAuthorizedUnits } from "~/lib/auth/course-access.server";
import type { RbacUser } from "~/lib/rbac/types";

export type CourseIdentity = { code: string; section: string; year: number; term: string };

const MATCH_LIMIT = 5;

const DUPLICATE_SUMMARY_SELECT = {
  id: true,
  name: true,
  code: true,
  section: true,
  term: true,
  year: true,
  startDate: true,
  department: true,
  deletedAt: true,
} satisfies Prisma.CourseSelect;

type DuplicateSummary = Prisma.CourseGetPayload<{ select: typeof DUPLICATE_SUMMARY_SELECT }>;

export function identityWhere(identity: CourseIdentity) {
  return {
    code: identity.code,
    section: identity.section,
    year: identity.year,
    term: identity.term,
  };
}

/** Live rows that hold the identity slot; Canvas rows are outside the partial unique index. */
export function liveIdentityWhere(identity: CourseIdentity) {
  return { ...identityWhere(identity), deletedAt: null, externalSource: null };
}

/** Who may bring a soft-deleted course back: admins, its unit's admins, or one of its active instructors. */
export async function canRestoreCourse(
  user: RbacUser,
  course: { id: string; department: string | null },
): Promise<boolean> {
  if (user.role === "ADMIN") return true;
  if (user.role === "UNIT_ADMIN") {
    const units = await getAuthorizedUnits(user);
    if (course.department && units.includes(course.department)) return true;
  }
  const enrollment = await prisma.enrollment.findFirst({
    where: { courseId: course.id, userId: user.id, role: "INSTRUCTOR", isActive: true },
    select: { id: true },
  });
  return enrollment != null;
}

/** Deleted courses the user may hear about: all for ADMIN, their units for UNIT_ADMIN, else ones they were on. */
async function deletedVisibilityWhere(user: RbacUser): Promise<Prisma.CourseWhereInput> {
  if (user.role === "ADMIN") return {};
  const own: Prisma.CourseWhereInput[] = [
    { instructorId: user.id },
    { enrollments: { some: { userId: user.id } } },
  ];
  if (user.role === "UNIT_ADMIN") {
    own.push({ department: { in: await getAuthorizedUnits(user) } });
  }
  return { OR: own };
}

/**
 * Soft-deleted rows at the exact identity that `user` can see, plus live rows taught by one of
 * `instructorUserIds` that share the code and differ in exactly one of
 * section / year / term (likely a typo or a re-offering worth confirming).
 */
export async function findDuplicateWarnings(
  user: RbacUser,
  identity: CourseIdentity,
  instructorUserIds: string[],
) {
  const visible = await deletedVisibilityWhere(user);
  const [deleted, similar] = await Promise.all([
    prisma.course.findMany({
      where: { ...identityWhere(identity), deletedAt: { not: null }, AND: visible },
      orderBy: { deletedAt: "desc" },
      take: MATCH_LIMIT,
      select: DUPLICATE_SUMMARY_SELECT,
    }),
    prisma.course.findMany({
      where: {
        deletedAt: null,
        code: identity.code,
        OR: [
          { section: { not: identity.section }, year: identity.year, term: identity.term },
          { section: identity.section, year: { not: identity.year }, term: identity.term },
          { section: identity.section, year: identity.year, term: { not: identity.term } },
        ],
        AND: {
          OR: [
            { instructorId: { in: instructorUserIds } },
            {
              enrollments: {
                some: { role: "INSTRUCTOR", isActive: true, userId: { in: instructorUserIds } },
              },
            },
          ],
        },
      },
      orderBy: { startDate: "desc" },
      take: MATCH_LIMIT,
      select: DUPLICATE_SUMMARY_SELECT,
    }),
  ]);

  const deletedMatches = await Promise.all(
    deleted.map(async (course) => ({
      ...toSummary(course),
      canRestore: await canRestoreCourse(user, course),
    })),
  );
  return { deletedMatches, similarCourses: similar.map(toSummary) };
}

function toSummary(course: DuplicateSummary) {
  return {
    id: course.id,
    name: course.name,
    code: course.code,
    section: course.section,
    term: course.term,
    year: course.year,
    startDate: course.startDate.toISOString(),
    deletedAt: course.deletedAt?.toISOString() ?? null,
  };
}
