/**
 * DB-backed tests for /api/questions and /api/assessments (happy paths).
 * Auth is handled by stubbing global fetch for Core session validation.
 * User + course data is seeded directly via Prisma.
 * Requires TEST_DATABASE_URL — see docs/TEST_PLAN.md. Run: npm run test:integration
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { teachingInstructorFetch, coursePage } from '../helpers/teachingInstructorFetch.js';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const { default: app } = await import('../../src/app.js');

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

const TEST_USER = { id: 'cuid-qna-user', email: 'qna@test.com', role: 'INSTRUCTOR', name: 'QnA User' };

const cookie = () => ({ Cookie: 'session=valid' });

describeDb('Questions & assessments (integration)', () => {
  let connectTestDatabase, truncateTestDatabase, prisma;
  let seedCoursesForNewUser;
  let courseId, topicId;

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    connectTestDatabase = testDb.connectTestDatabase;
    truncateTestDatabase = testDb.truncateTestDatabase;
    prisma = testDb.prisma;
    await connectTestDatabase();

    ({ seedCoursesForNewUser } = await import('../helpers/seedCoursesFixture.js'));
  });

  beforeEach(async () => {
    await truncateTestDatabase();

    await prisma.user.create({ data: { id: TEST_USER.id, email: TEST_USER.email, name: TEST_USER.name } });
    await seedCoursesForNewUser(TEST_USER.id);

    const course = await prisma.course.findFirst({ where: { userId: TEST_USER.id } });
    courseId = course.id;
    const topic = await prisma.topics.findFirst({ where: { courseId } });
    topicId = topic.id;

    vi.stubGlobal('fetch', vi.fn().mockImplementation(await teachingInstructorFetch(TEST_USER, prisma)));
  });

  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('creates a question and lists it in GET /api/questions', async () => {
    const create = await request(app)
      .post('/api/questions')
      .set(cookie())
      .send({ description: 'Integration test question', courseId, primaryTopicId: topicId, type: 'MCQ' });
    expect(create.status).toBe(201);
    expect(create.body.data.id).toBeTruthy();

    const list = await request(app).get('/api/questions').set(cookie());
    expect(list.status).toBe(200);
    expect(list.body.data.items.some((q) => q.id === create.body.data.id)).toBe(true);
    expect(list.body.data.total).toBeGreaterThanOrEqual(1);
    expect(list.body.data.limit).toBe(50);
    expect(list.body.data.offset).toBe(0);
  });

  it('creates an assessment and fetches it by id', async () => {
    const createA = await request(app)
      .post('/api/assessments')
      .set(cookie())
      .send({ type: 'Quiz', name: 'Integration Exam', semester: 'Fall 2026', courseId });
    expect(createA.status).toBe(201);
    const id = createA.body.data.id;

    const getOne = await request(app).get(`/api/assessments/${id}`).set(cookie());
    expect(getOne.status).toBe(200);
    expect(getOne.body.data.name).toBe('Integration Exam');
    expect(getOne.body.data.courseId).toBe(courseId);
  });

  it('rejects a question with invalid type', async () => {
    const res = await request(app)
      .post('/api/questions')
      .set(cookie())
      .send({ description: 'X', courseId, primaryTopicId: topicId, type: 'TF' });
    expect(res.status).toBe(400);
  });

  it('rejects a question when primaryTopicId is missing', async () => {
    const res = await request(app)
      .post('/api/questions')
      .set(cookie())
      .send({ description: 'X', courseId, primaryTopicId: '', type: 'MCQ' });
    expect(res.status).toBe(400);
  });

  it('creates a course via POST when coreCourseId is in the caller\'s scoped Core list, and sees it in GET /api/course', async () => {
    const name = 'Custom Integration Course';
    const coreCourseId = 'core-cuid-int-999';

    // Local-only creation is retired (#1072 §4 step 7): POST now requires and
    // validates coreCourseId against Core's scoped course list, then reads the
    // created course back through Core. Route fetch by URL suffix so both the
    // list endpoint (scope check + auto-import + list read-through) and the
    // detail endpoint (create read-through) resolve correctly regardless of
    // call order.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url) => {
        const target = String(url);
        // #1041: the course list is always called with query params
        // (`?page=&pageSize=` or `?ids=`), so match on the path, not the tail.
        const path = target.split('?')[0];
        if (target.endsWith('/api/sessions/validate')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: TEST_USER }) });
        }
        if (path.endsWith(`/api/courses/${coreCourseId}/enrollments`)) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                enrollments: [{ studentId: TEST_USER.id, role: 'INSTRUCTOR', isActive: true }],
              }),
          });
        }
        if (path.endsWith(`/api/courses/${coreCourseId}`)) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: coreCourseId, name, code: 'INT-999' }),
          });
        }
        if (path.endsWith('/api/courses')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve(
                coursePage([
                  {
                    id: coreCourseId,
                    code: 'INT-999',
                    name,
                    callerEnrollmentRole: 'INSTRUCTOR',
                  },
                ]),
              ),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }),
    );

    const created = await request(app)
      .post('/api/course')
      .set(cookie())
      .send({ name, courseCode: 'INT-999', coreCourseId });
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe(name);
    expect(created.body.data.coreCourseId).toBe(coreCourseId);

    const list = await request(app).get('/api/course?page=1&pageSize=100').set(cookie());
    expect(list.body.data.some((c) => c.id === created.body.data.id && c.name === name)).toBe(true);
    // Pagination envelope (#1044): data stays a bare array, with metadata siblings.
    expect(list.body).toMatchObject({ page: 1, pageSize: 100 });
    expect(typeof list.body.total).toBe('number');

    // The list endpoint requires page/pageSize (#1044) — missing params 400 with a code.
    const missingParams = await request(app).get('/api/course').set(cookie());
    expect(missingParams.status).toBe(400);
    expect(missingParams.body.code).toBe('PAGINATION_REQUIRED');

    // Idempotent ensure (unified contract): re-POSTing the same coreCourseId
    // (racing the background mirror, or a plain retry) succeeds with the
    // existing anchor rather than a unique-constraint error.
    const again = await request(app)
      .post('/api/course')
      .set(cookie())
      .send({ coreCourseId });
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(created.body.data.id);
  });

  it('rejects course creation without a coreCourseId', async () => {
    const res = await request(app)
      .post('/api/course')
      .set(cookie())
      .send({ name: 'No Core Link', courseCode: 'NL-1' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects course creation when coreCourseId is outside the caller\'s scoped Core list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url) => {
        const target = String(url);
        // #1041: the course list is always called with query params
        // (`?page=&pageSize=` or `?ids=`), so match on the path, not the tail.
        const path = target.split('?')[0];
        if (target.endsWith('/api/sessions/validate')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: TEST_USER }) });
        }
        if (path.endsWith('/api/courses')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(coursePage([{ id: 'some-other-course', code: 'OTH-1' }])),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }),
    );

    const res = await request(app)
      .post('/api/course')
      .set(cookie())
      .send({ name: 'Unauthorized Link', courseCode: 'UL-1', coreCourseId: 'core-cuid-not-scoped' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CORE_COURSE_NOT_AUTHORIZED');
  });

  it('creates a question, adds a variant, and lists variants', async () => {
    const createQ = await request(app)
      .post('/api/questions')
      .set(cookie())
      .send({ description: 'Variant parent', courseId, primaryTopicId: topicId, type: 'MCQ' });
    expect(createQ.status).toBe(201);
    const qid = createQ.body.data.id;

    const alist = await request(app).get('/api/assessments').set(cookie()).query({ courseId });
    const practice = alist.body.data.items.find((a) => a.name === 'Practice Exam');
    expect(practice).toBeTruthy();

    const v = await request(app)
      .post(`/api/questions/${qid}/variants`)
      .set(cookie())
      .send({
        questionText: 'What is 2+2?',
        difficulty: 'easy',
        reasoningLevel: 'factual',
        assessmentId: practice.id,
        answer: 'A',
        choices: [{ letter: 'A', text: '4' }, { letter: 'B', text: '5' }],
        isDraft: false,
      });
    expect(v.status).toBe(201);
    expect(v.body.data.id).toBeTruthy();

    const listV = await request(app).get(`/api/questions/${qid}/variants`).set(cookie());
    expect(listV.status).toBe(200);
    expect(Array.isArray(listV.body.data)).toBe(true);
    expect(listV.body.data.length).toBeGreaterThan(0);
  });

  it('returns 400 when variant has empty questionText', async () => {
    const createQ = await request(app)
      .post('/api/questions')
      .set(cookie())
      .send({ description: 'No variant text test', courseId, primaryTopicId: topicId, type: 'MCQ' });
    const qid = createQ.body.data.id;

    const res = await request(app)
      .post(`/api/questions/${qid}/variants`)
      .set(cookie())
      .send({ questionText: '   ' });
    expect(res.status).toBe(400);
  });

  it('paginates questions and assessments with total/limit/offset metadata (#1040)', async () => {
    for (let i = 0; i < 55; i += 1) {
      const create = await request(app)
        .post('/api/questions')
        .set(cookie())
        .send({
          description: `Pagination Q ${i}`,
          courseId,
          primaryTopicId: topicId,
          type: 'MCQ',
        });
      expect(create.status).toBe(201);
    }

    const page1 = await request(app)
      .get('/api/questions')
      .set(cookie())
      .query({ courseId, limit: 50, offset: 0 });
    expect(page1.status).toBe(200);
    expect(page1.body.data.items).toHaveLength(50);
    expect(page1.body.data.total).toBeGreaterThanOrEqual(55);
    expect(page1.body.data.limit).toBe(50);
    expect(page1.body.data.offset).toBe(0);

    const page2 = await request(app)
      .get('/api/questions')
      .set(cookie())
      .query({ courseId, limit: 50, offset: 50 });
    expect(page2.status).toBe(200);
    expect(page2.body.data.items.length).toBeGreaterThanOrEqual(5);
    expect(page2.body.data.offset).toBe(50);
    expect(page2.body.data.total).toBe(page1.body.data.total);

    const ids = new Set([
      ...page1.body.data.items.map((q) => q.id),
      ...page2.body.data.items.map((q) => q.id),
    ]);
    expect(ids.size).toBe(page1.body.data.items.length + page2.body.data.items.length);

    const assessments = await request(app)
      .get('/api/assessments')
      .set(cookie())
      .query({ courseId, limit: 10, offset: 0 });
    expect(assessments.status).toBe(200);
    expect(Array.isArray(assessments.body.data.items)).toBe(true);
    expect(typeof assessments.body.data.total).toBe('number');
    expect(assessments.body.data.limit).toBe(10);
    expect(assessments.body.data.offset).toBe(0);
  });
});
