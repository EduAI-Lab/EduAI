/**
 * DB-backed concurrency regression for auto-import provisioning.
 *
 * Two co-instructors provision the same course simultaneously (mirrors are
 * throttled per USER, so this happens in production whenever both log in
 * within the throttle window). The check-then-create in ensurePracticeExam
 * must not produce two Practice Exams — serialization is a per-course
 * Postgres advisory lock, so this test needs a real database.
 *
 * Requires TEST_DATABASE_URL (skips otherwise, same as the other DB suites).
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

vi.mock('../../src/services/coreApiService.js', () => ({
  listCoursesFromCore: vi.fn(),
  getCourseEnrollmentsFromCore: vi.fn(),
}));

vi.mock('../../src/services/topicSyncService.js', () => ({
  syncTopicsFromCoreForCourse: vi.fn().mockResolvedValue(0),
}));

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

const CORE_COURSE_ID = 'core-concurrency-1';

describeDb('auto-import Practice Exam concurrency', () => {
  let connectTestDatabase, truncateTestDatabase, prisma;
  let importTaughtCoursesFromCore;
  let listCoursesFromCore, getCourseEnrollmentsFromCore;

  beforeAll(async () => {
    ({ connectTestDatabase, truncateTestDatabase, prisma } = await import('../helpers/testDb.js'));
    ({ importTaughtCoursesFromCore } = await import(
      '../../src/services/importTaughtCoursesService.js'
    ));
    ({ listCoursesFromCore, getCourseEnrollmentsFromCore } = await import(
      '../../src/services/coreApiService.js'
    ));
    await connectTestDatabase();
  });

  beforeEach(async () => {
    await truncateTestDatabase();
    await prisma.user.createMany({
      data: [
        { id: 'inst-a', email: 'a@test.com', name: 'Instructor A' },
        { id: 'inst-b', email: 'b@test.com', name: 'Instructor B' },
      ],
    });

    listCoursesFromCore.mockResolvedValue({
      courses: [{ id: CORE_COURSE_ID, callerEnrollmentRole: 'INSTRUCTOR' }],
    });
    getCourseEnrollmentsFromCore.mockResolvedValue({
      enrollments: [
        { studentId: 'inst-a', role: 'INSTRUCTOR', isActive: true },
        { studentId: 'inst-b', role: 'INSTRUCTOR', isActive: true },
      ],
    });
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('two co-instructors importing concurrently produce one anchor and ONE Practice Exam', async () => {
    const [resultA, resultB] = await Promise.all([
      importTaughtCoursesFromCore('inst-a', 'INSTRUCTOR', 'session=a'),
      importTaughtCoursesFromCore('inst-b', 'INSTRUCTOR', 'session=b'),
    ]);

    // Exactly one anchor row for the Core course (unique core_course_id; the
    // create-race loser adopts the winner's row).
    const anchors = await prisma.course.findMany({ where: { coreCourseId: CORE_COURSE_ID } });
    expect(anchors).toHaveLength(1);

    // The regression: both callers saw "no Practice Exam yet" and both
    // created one. The advisory lock serializes the check-then-create.
    const exams = await prisma.assessments.findMany({
      where: { courseId: anchors[0].id, name: 'Practice Exam' },
    });
    expect(exams).toHaveLength(1);

    // Both callers fully provisioned, neither errored out.
    expect(resultA.synced).toBe(1);
    expect(resultB.synced).toBe(1);
    expect((resultA.imported ?? 0) + (resultB.imported ?? 0)).toBe(1);
  });

  it('repeated sequential imports never add a second Practice Exam', async () => {
    await importTaughtCoursesFromCore('inst-a', 'INSTRUCTOR', 'session=a');
    await importTaughtCoursesFromCore('inst-b', 'INSTRUCTOR', 'session=b');
    await importTaughtCoursesFromCore('inst-a', 'INSTRUCTOR', 'session=a');

    const anchors = await prisma.course.findMany({ where: { coreCourseId: CORE_COURSE_ID } });
    expect(anchors).toHaveLength(1);
    const exams = await prisma.assessments.findMany({
      where: { courseId: anchors[0].id, name: 'Practice Exam' },
    });
    expect(exams).toHaveLength(1);
  });
});
