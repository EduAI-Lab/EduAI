/**
 * Real-DB route regressions for course-target authorization and the pre-MVP
 * no-relocation invariant. The caller is enrolled on course A only in the
 * first pair, then on both courses in the second pair; both QM anchors have
 * the same owner to prove that owner scoping cannot stand in for caller access.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb('QM cross-course authorization (real DB)', () => {
  let connectTestDatabase, truncateTestDatabase, prisma, app;

  const OWNER = { id: 'qm-xc-owner', email: 'qm-xc-owner@test.com', name: 'QM owner' };
  const CALLER = { id: 'qm-xc-caller', email: 'qm-xc-caller@test.com', name: 'QM caller', role: 'INSTRUCTOR' };

  let courseA, courseB, topicA, questionA, assessmentA;

  function coreResponse(body, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => body,
    };
  }

  function stubCore({ enrolledCourses = [] } = {}) {
    const fetchMock = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/sessions/validate')) {
        return coreResponse({ user: CALLER });
      }

      const enrollmentsMatch = url.match(/\/api\/courses\/([^/]+)\/enrollments$/);
      if (enrollmentsMatch) {
        const coreCourseId = enrollmentsMatch[1];
        return coreResponse({
          enrollments: enrolledCourses.includes(coreCourseId)
            ? [{ studentId: CALLER.id, role: 'INSTRUCTOR', isActive: true }]
            : [],
        });
      }

      const scopedCoursesMatch = url.match(/\/api\/courses\?ids=([^&]+)/);
      if (scopedCoursesMatch) {
        const ids = decodeURIComponent(scopedCoursesMatch[1]).split(',');
        return coreResponse({
          data: ids
            .filter((id) => enrolledCourses.includes(id))
            .map((id) => ({ id })),
          total: ids.filter((id) => enrolledCourses.includes(id)).length,
          page: 1,
          pageSize: 200,
        });
      }

      const courseMatch = url.match(/\/api\/courses\/([^/]+)$/);
      if (courseMatch) {
        return coreResponse({ id: courseMatch[1], name: 'Test course', code: 'QM-XC', term: 'W1', year: 2026 });
      }

      return coreResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    ({ connectTestDatabase, truncateTestDatabase, prisma } = testDb);
    await connectTestDatabase();
    ({ default: app } = await import('../../src/app.js'));
  });

  beforeEach(async () => {
    await truncateTestDatabase();
    await prisma.user.createMany({ data: [
      { id: OWNER.id, email: OWNER.email, name: OWNER.name },
      { id: CALLER.id, email: CALLER.email, name: CALLER.name },
    ] });

    courseA = await prisma.course.create({ data: { userId: OWNER.id, coreCourseId: 'qm-xc-core-a' } });
    courseB = await prisma.course.create({ data: { userId: OWNER.id, coreCourseId: 'qm-xc-core-b' } });
    topicA = await prisma.topics.create({ data: { id: 'qm-xc-topic-a', name: 'A', courseId: courseA.id } });
    await prisma.topics.create({ data: { id: 'qm-xc-topic-b', name: 'B', courseId: courseB.id } });
    questionA = await prisma.questionMetadata.create({
      data: { courseId: courseA.id, primaryTopicId: topicA.id, type: 'SA', questionOrder: {}, createdBy: OWNER.id },
    });
    assessmentA = await prisma.assessments.create({ data: { courseId: courseA.id, type: 'Quiz', name: 'A' } });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (prisma) await prisma.$disconnect();
  });

  it('returns stable relocation conflict before question service mutation', async () => {
    stubCore({ enrolledCourses: [courseA.coreCourseId] });
    const response = await request(app)
      .put(`/api/questions/${questionA.id}`)
      .set('Cookie', 'session=qm-xc')
      .send({ description: 'attempted move', courseId: courseB.id });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'COURSE_RELOCATION_NOT_ALLOWED' });
    const row = await prisma.questionMetadata.findUnique({ where: { id: questionA.id } });
    expect(row.courseId).toBe(courseA.id);
  });

  it('returns 403 before assessment service mutation when target B is inaccessible', async () => {
    stubCore({ enrolledCourses: [courseA.coreCourseId] });
    const response = await request(app)
      .put(`/api/assessments/${assessmentA.id}`)
      .set('Cookie', 'session=qm-xc')
      .send({ name: 'attempted move', courseId: courseB.id });

    expect(response.status).toBe(403);
    const row = await prisma.assessments.findUnique({ where: { id: assessmentA.id } });
    expect(row.courseId).toBe(courseA.id);
  });

  it('rejects a cross-course question move even when the caller is authorized on both courses', async () => {
    stubCore({ enrolledCourses: [courseA.coreCourseId, courseB.coreCourseId] });
    const response = await request(app)
      .put(`/api/questions/${questionA.id}`)
      .set('Cookie', 'session=qm-xc')
      .send({ description: 'authorized target but unsupported move', courseId: courseB.id });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/relocation is not supported/i);
    const row = await prisma.questionMetadata.findUnique({ where: { id: questionA.id } });
    expect(row.courseId).toBe(courseA.id);
  });

  it('rejects a cross-course assessment move even when the caller is authorized on both courses', async () => {
    stubCore({ enrolledCourses: [courseA.coreCourseId, courseB.coreCourseId] });
    const response = await request(app)
      .put(`/api/assessments/${assessmentA.id}`)
      .set('Cookie', 'session=qm-xc')
      .send({ name: 'authorized target but unsupported move', courseId: courseB.id });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/relocation is not supported/i);
    const row = await prisma.assessments.findUnique({ where: { id: assessmentA.id } });
    expect(row.courseId).toBe(courseA.id);
  });

  it('keeps a linked anchor and all content on A when a caller can see target B', async () => {
    const fetchMock = stubCore({ enrolledCourses: [courseA.coreCourseId, courseB.coreCourseId] });

    const response = await request(app)
      .patch(`/api/course/${courseA.id}/link-core`)
      .set('Cookie', 'session=qm-xc')
      .send({ coreCourseId: courseB.coreCourseId });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: 'CORE_COURSE_LINK_IMMUTABLE',
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes(`ids=${courseB.coreCourseId}`))).toBe(false);

    const [anchor, topic, question, assessment] = await Promise.all([
      prisma.course.findUnique({ where: { id: courseA.id } }),
      prisma.topics.findUnique({ where: { id: topicA.id } }),
      prisma.questionMetadata.findUnique({ where: { id: questionA.id } }),
      prisma.assessments.findUnique({ where: { id: assessmentA.id } }),
    ]);
    expect(anchor.coreCourseId).toBe(courseA.coreCourseId);
    expect(topic.courseId).toBe(courseA.id);
    expect(question.courseId).toBe(courseA.id);
    expect(assessment.courseId).toBe(courseA.id);
  });

  it('returns the same conflict for an unauthorized target without probing it', async () => {
    const fetchMock = stubCore({ enrolledCourses: [courseA.coreCourseId] });

    const response = await request(app)
      .patch(`/api/course/${courseA.id}/link-core`)
      .set('Cookie', 'session=qm-xc')
      .send({ coreCourseId: courseB.coreCourseId });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: 'CORE_COURSE_LINK_IMMUTABLE',
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes(`ids=${courseB.coreCourseId}`))).toBe(false);
    const unchanged = await prisma.course.findUnique({ where: { id: courseA.id } });
    expect(unchanged.coreCourseId).toBe(courseA.coreCourseId);
  });

  it('allows legitimate same-course question and assessment updates', async () => {
    stubCore({ enrolledCourses: [courseA.coreCourseId] });
    const questionResponse = await request(app)
      .put(`/api/questions/${questionA.id}`)
      .set('Cookie', 'session=qm-xc')
      .send({ description: 'same course', primaryTopicId: topicA.id });
    expect(questionResponse.status).toBe(200);

    const assessmentResponse = await request(app)
      .put(`/api/assessments/${assessmentA.id}`)
      .set('Cookie', 'session=qm-xc')
      .send({ name: 'same course' });
    expect(assessmentResponse.status).toBe(200);
  });
});
