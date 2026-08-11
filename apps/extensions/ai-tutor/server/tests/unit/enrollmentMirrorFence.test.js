import { beforeEach, describe, expect, it, vi } from 'vitest';

const courseOfferingFindFirst = vi.fn();
const courseOfferingFindUnique = vi.fn();
const courseEnrollmentUpsert = vi.fn();
const courseEnrollmentFindMany = vi.fn();
const courseEnrollmentFindUnique = vi.fn();
const courseEnrollmentCreateMany = vi.fn();
const courseEnrollmentDeleteMany = vi.fn();
const courseEnrollmentUpdate = vi.fn();

const prisma = {
  courseOffering: {
    findFirst: courseOfferingFindFirst,
    findUnique: courseOfferingFindUnique,
  },
  courseEnrollment: {
    upsert: courseEnrollmentUpsert,
    findMany: courseEnrollmentFindMany,
    findUnique: courseEnrollmentFindUnique,
    createMany: courseEnrollmentCreateMany,
    deleteMany: courseEnrollmentDeleteMany,
    update: courseEnrollmentUpdate,
  },
};

vi.mock('../../src/config/database.js', () => ({ prisma }));

const listEduAiCourses = vi.fn();
const listEduAiCourseEnrollmentsServiceKey = vi.fn();

vi.mock('../../src/services/eduaiClient.js', () => ({
  listEduAiCourses,
  listEduAiCourseEnrollmentsServiceKey,
}));

vi.mock('../../src/services/topicSync.js', () => ({
  syncExternalCourseTopics: vi.fn().mockResolvedValue(undefined),
}));

const { authorizeLiveStudentEnrollment } = await import(
  '../../src/services/enrollmentSync.js'
);
const { importEnrolledCoursesFromCore } = await import(
  '../../src/services/importTaughtCoursesService.js'
);

const COURSE = { id: 1, coreOfferingId: 'core-course-1' };
const CORE_STUDENT_COURSE = {
  id: 'core-course-1',
  callerEnrollmentRole: 'STUDENT',
};
const ACTIVE_ROSTER_ENTRY = {
  studentId: 'student-1',
  studentEmail: 'student@example.com',
  studentName: 'Student One',
  enrolledAt: '2026-01-01T00:00:00.000Z',
  isActive: true,
  role: 'STUDENT',
};

describe('CourseEnrollment mirror/live authorization fence', () => {
  let rows;

  beforeEach(() => {
    vi.clearAllMocks();
    rows = [];
    courseOfferingFindFirst.mockResolvedValue({ id: 1, coreOfferingId: 'core-course-1' });
    courseOfferingFindUnique.mockResolvedValue(COURSE);
    courseEnrollmentFindMany.mockImplementation(async (args) => {
      if (args?.include) {
        return rows.map((row) => ({
          ...row,
          courseOffering: { coreOfferingId: 'core-course-1' },
        }));
      }
      return rows.map(({ userId, role }) => ({ userId, role }));
    });
    courseEnrollmentFindUnique.mockImplementation(async ({ where }) => {
      const key = where?.courseOfferingId_userId;
      return (
        rows.find(
          (row) =>
            row.courseOfferingId === key?.courseOfferingId && row.userId === key?.userId,
        ) ?? null
      );
    });
    courseEnrollmentCreateMany.mockImplementation(async ({ data }) => {
      rows.push(...data.map((row) => ({ ...row })));
      return { count: data.length };
    });
    courseEnrollmentUpdate.mockImplementation(async ({ where, data }) => {
      const key = where.courseOfferingId_userId;
      const row = rows.find(
        (candidate) =>
          candidate.courseOfferingId === key.courseOfferingId &&
          candidate.userId === key.userId,
      );
      if (row) Object.assign(row, data);
      return row;
    });
    courseEnrollmentDeleteMany.mockImplementation(async ({ where }) => {
      const before = rows.length;
      rows = rows.filter((row) => {
        if (row.courseOfferingId !== where.courseOfferingId) return true;
        if (where.userId?.in && !where.userId.in.includes(row.userId)) return true;
        if (where.userId && typeof where.userId === 'string' && row.userId !== where.userId) {
          return true;
        }
        return false;
      });
      return { count: before - rows.length };
    });
    listEduAiCourses.mockResolvedValue([CORE_STUDENT_COURSE]);
    listEduAiCourseEnrollmentsServiceKey.mockResolvedValue([]);
  });

  it('rechecks a stale course-list candidate after a live revocation before writing', async () => {
    let releaseOfferingLookup;
    let resolveOfferingLookupStarted;
    const offeringLookupStarted = new Promise((resolve) => {
      resolveOfferingLookupStarted = resolve;
    });
    const offeringLookupRelease = new Promise((resolve) => {
      releaseOfferingLookup = resolve;
    });
    courseOfferingFindFirst.mockImplementation(async () => {
      resolveOfferingLookupStarted();
      await offeringLookupRelease;
      return { id: 1, coreOfferingId: 'core-course-1' };
    });

    const staleMirror = importEnrolledCoursesFromCore(
      { id: 'student-1', role: 'STUDENT' },
      'session=stale',
      { coreCourses: [CORE_STUDENT_COURSE] },
    );
    // The broad Core course list is now stale, but the mirror has not yet
    // entered the per-course authoritative reconciliation.
    await offeringLookupStarted;

    const liveAuthorization = authorizeLiveStudentEnrollment(1, 'student-1', {
      course: COURSE,
    });

    const authorizationResult = await liveAuthorization;
    expect(authorizationResult).toEqual({ allowed: false, state: 'denied', role: null });

    releaseOfferingLookup();
    const mirrorResult = await staleMirror;

    expect(mirrorResult).toMatchObject({ enrolled: 1, removed: 0 });
    expect(rows).toEqual([]);
    // Live authorization and the mirror's per-course reconciliation each
    // fetched the authoritative roster; the stale list never became a write.
    expect(listEduAiCourseEnrollmentsServiceKey).toHaveBeenCalledTimes(2);
    expect(courseEnrollmentUpsert).not.toHaveBeenCalled();
  });

  it('serializes mirror and live authoritative fetches so revocation wins', async () => {
    let releaseMirrorFetch;
    let resolveMirrorFetchStarted;
    const mirrorFetchStarted = new Promise((resolve) => {
      resolveMirrorFetchStarted = resolve;
    });
    const mirrorFetchRelease = new Promise((resolve) => {
      releaseMirrorFetch = resolve;
    });
    let fetchCount = 0;
    let activeFetches = 0;
    let maxActiveFetches = 0;
    listEduAiCourseEnrollmentsServiceKey.mockImplementation(async () => {
      fetchCount++;
      activeFetches++;
      maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
      if (fetchCount === 1) {
        resolveMirrorFetchStarted();
        await mirrorFetchRelease;
        activeFetches--;
        return [ACTIVE_ROSTER_ENTRY];
      }
      activeFetches--;
      return [];
    });

    const staleMirror = importEnrolledCoursesFromCore(
      { id: 'student-1', role: 'STUDENT' },
      'session=stale',
      { coreCourses: [CORE_STUDENT_COURSE] },
    );
    await mirrorFetchStarted;

    const liveAuthorization = authorizeLiveStudentEnrollment(1, 'student-1', {
      course: COURSE,
    });
    await new Promise((resolve) => setImmediate(resolve));

    // The mirror owns the course lock while its authoritative fetch is
    // pending, so live authorization cannot fetch/reconcile concurrently.
    expect(fetchCount).toBe(1);
    expect(maxActiveFetches).toBe(1);

    releaseMirrorFetch();
    const [mirrorResult, authorizationResult] = await Promise.all([
      staleMirror,
      liveAuthorization,
    ]);

    expect(mirrorResult).toMatchObject({ enrolled: 1, removed: 0 });
    expect(authorizationResult).toEqual({ allowed: false, state: 'denied', role: null });
    expect(rows).toEqual([]);
    expect(fetchCount).toBe(2);
    expect(maxActiveFetches).toBe(1);
  });
});
