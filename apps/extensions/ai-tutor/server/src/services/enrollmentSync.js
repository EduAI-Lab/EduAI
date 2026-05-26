/**
 * Enrollment sync — stubbed pending reimplementation.
 *
 * The previous implementation used Better Auth's `account` and `user` tables
 * plus a `courseEnrollment` Prisma model that no longer exist after the
 * auth-pipeline unification (Phase 2). Reimplementation will use Core's
 * enrollment API directly once the endpoint is defined.
 */

export async function syncCourseEnrollments(_courseOfferingId, _options = {}) {
  return { synced: 0, created: 0, errors: [] };
}
