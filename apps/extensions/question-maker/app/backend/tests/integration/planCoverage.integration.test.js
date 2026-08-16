/**
 * DB-backed tests covering cross-user isolation, extract/save persistence,
 * and assessment variant assembly.
 * Auth is handled by stubbing global fetch for Core session validation.
 * User + course data is seeded directly via Prisma.
 * Requires TEST_DATABASE_URL — see docs/TEST_PLAN.md. Run: npm run test:integration
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { teachingInstructorFetch } from '../helpers/teachingInstructorFetch.js';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const { default: app } = await import('../../src/app.js');

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

const USER_A = { id: 'cuid-plan-user-a', email: 'usera@test.com', role: 'INSTRUCTOR', name: 'User A' };
const USER_B = { id: 'cuid-plan-user-b', email: 'userb@test.com', role: 'INSTRUCTOR', name: 'User B' };

/** Persistent fetch stub that always returns the given user for session validation. */
function sessionFetch(user) {
  return vi.fn().mockImplementation((url) => {
    const path = String(url).split('?')[0];
    if (path.endsWith('/api/sessions/validate')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ user }) });
    }
    if (/\/enrollments$/.test(path)) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            enrollments: [{ studentId: user.id, role: 'INSTRUCTOR', isActive: true }],
          }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

/** Fetch stub that routes to USER_A or USER_B based on the cookie value. */
function twoUserFetch() {
  return vi.fn().mockImplementation((url, opts) => {
    const path = String(url).split('?')[0];
    const cookie = opts?.headers?.cookie ?? '';
    const user = cookie.includes('session=user-a') ? USER_A : USER_B;
    if (path.endsWith('/api/sessions/validate')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ user }) });
    }
    if (/\/enrollments$/.test(path)) {
      const enrollments =
        user.id === USER_A.id
          ? [{ studentId: USER_A.id, role: 'INSTRUCTOR', isActive: true }]
          : [];
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ enrollments }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

const cookieA = () => ({ Cookie: 'session=user-a' });
const cookieB = () => ({ Cookie: 'session=user-b' });

const extractFirstSectionVariantId = (assessment) =>
  assessment?.sections?.[0]?.sectionVariants?.[0]?.variant?.id ?? null;

describeDb('Plan coverage (integration)', () => {
  let connectTestDatabase, truncateTestDatabase, prisma;
  let seedCoursesForNewUser;

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
  });

  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  // Helper: seed a user with default courses and return their first course + topic.
  async function seedUser(user) {
    await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name } });
    await seedCoursesForNewUser(user.id);
    const course = await prisma.course.findFirst({ where: { userId: user.id } });
    const topic = await prisma.topics.findFirst({ where: { courseId: course.id } });
    return { courseId: course.id, topicId: topic.id };
  }

  it('returns 404 when fetching another user course by id', async () => {
    const { courseId: courseIdA } = await seedUser(USER_A);
    await prisma.user.create({ data: { id: USER_B.id, email: USER_B.email, name: USER_B.name } });

    vi.stubGlobal('fetch', twoUserFetch());

    const res = await request(app)
      .get(`/api/course/${courseIdA}`)
      .set(cookieB());
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('persists extracted questions via POST /api/questions/extract/save', async () => {
    const { courseId, topicId } = await seedUser(USER_A);
    vi.stubGlobal('fetch', sessionFetch(USER_A));

    const res = await request(app)
      .post('/api/questions/extract/save')
      .set(cookieA())
      .send({
        courseId,
        primaryTopicId: topicId,
        questions: [{ question: 'What is 2+2?', summary: 'Single-digit addition', type: 'SA', difficulty: 'easy', answer: '4' }],
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(1);
  });

  it('assembles a variant exam from the Practice Exam via assemble-variants', async () => {
    const { courseId, topicId } = await seedUser(USER_A);
    vi.stubGlobal('fetch', sessionFetch(USER_A));

    const createQ = await request(app)
      .post('/api/questions')
      .set(cookieA())
      .send({ description: 'Assembly baseline metadata', courseId, primaryTopicId: topicId, type: 'MCQ' });
    expect(createQ.status).toBe(201);
    const qid = createQ.body.data.id;

    const alist = await request(app).get('/api/assessments').set(cookieA()).query({ courseId });
    const practice = alist.body.data.items.find((a) => a.name === 'Practice Exam');
    expect(practice).toBeTruthy();

    // The assemble flow reads questions from the reference assessment's sections,
    // so add a section to the Practice Exam and place a variant in it.
    const section = await request(app)
      .post(`/api/assessments/${practice.id}/sections`)
      .set(cookieA())
      .send({ name: 'Exam', position: 0 });
    expect(section.status).toBe(201);

    const v = await request(app)
      .post(`/api/questions/${qid}/variants`)
      .set(cookieA())
      .send({
        questionText: 'What is 2+2? A)1 B)2 C)3 D)4',
        difficulty: 'easy',
        reasoningLevel: 'factual',
        assessmentId: practice.id,
        answer: 'D',
        choices: [{ letter: 'A', text: '1' }, { letter: 'B', text: '2' }, { letter: 'C', text: '3' }, { letter: 'D', text: '4' }],
        isDraft: false,
      });
    expect(v.status).toBe(201);

    const addToSection = await request(app)
      .post(`/api/assessments/${practice.id}/sections/${section.body.data.id}/variants`)
      .set(cookieA())
      .send({ variantId: v.body.data.id, displayOrder: 0 });
    expect(addToSection.status).toBe(201);

    const asm = await request(app)
      .post('/api/assessment-variant/assemble-variants')
      .set(cookieA())
      .send({ referenceAssessmentId: practice.id, courseId, examLabels: ['Assembled-Integration'], includeDrafts: true });
    expect(asm.status).toBe(201);
    expect(asm.body.success).toBe(true);
    expect(asm.body.data.createdAssessments.length).toBe(1);
    expect(asm.body.data.slotsProcessed).toBeGreaterThan(0);
  });

  it('rotates slot variant picks fairly across runs and avoids baseline when alternatives exist', async () => {
    const { courseId, topicId } = await seedUser(USER_A);
    vi.stubGlobal('fetch', sessionFetch(USER_A));

    const createQ = await request(app)
      .post('/api/questions')
      .set(cookieA())
      .send({ description: 'Round-robin assembly metadata', courseId, primaryTopicId: topicId, type: 'MCQ' });
    expect(createQ.status).toBe(201);
    const questionId = createQ.body.data.id;

    const createBaseline = await request(app)
      .post('/api/assessments')
      .set(cookieA())
      .send({ type: 'Quiz', name: 'RR Baseline', semester: '2026W', courseId });
    expect(createBaseline.status).toBe(201);
    const baselineId = createBaseline.body.data.id;

    const createSection = await request(app)
      .post(`/api/assessments/${baselineId}/sections`)
      .set(cookieA())
      .send({ name: 'Exam', position: 0 });
    expect(createSection.status).toBe(201);
    const sectionId = createSection.body.data.id;

    const createVariant = (text) =>
      request(app)
        .post(`/api/questions/${questionId}/variants`)
        .set(cookieA())
        .send({
          questionText: text,
          difficulty: 'easy',
          reasoningLevel: 'factual',
          answer: 'D',
          choices: [{ letter: 'A', text: '1' }, { letter: 'B', text: '2' }, { letter: 'C', text: '3' }, { letter: 'D', text: '4' }],
          isDraft: false,
        });

    const [baselineVariantRes, altOneRes, altTwoRes] = await Promise.all([
      createVariant('Baseline stem A)1 B)2 C)3 D)4'),
      createVariant('Alternate 1 A)1 B)2 C)3 D)4'),
      createVariant('Alternate 2 A)1 B)2 C)3 D)4'),
    ]);
    expect(baselineVariantRes.status).toBe(201);
    expect(altOneRes.status).toBe(201);
    expect(altTwoRes.status).toBe(201);
    const baselineVariantId = baselineVariantRes.body.data.id;

    const addToSection = await request(app)
      .post(`/api/assessments/${baselineId}/sections/${sectionId}/variants`)
      .set(cookieA())
      .send({ variantId: baselineVariantId, displayOrder: 0 });
    expect(addToSection.status).toBe(201);

    const assembleOnce = (label) =>
      request(app)
        .post('/api/assessment-variant/assemble-variants')
        .set(cookieA())
        .send({ referenceAssessmentId: baselineId, courseId, examLabels: [label], includeDrafts: false });

    // Sequential — this test asserts deterministic round-robin rotation across
    // ordered runs. Concurrent assembly is covered separately below.
    const asm1 = await assembleOnce('RR-1');
    const asm2 = await assembleOnce('RR-2');
    const asm3 = await assembleOnce('RR-3');
    expect(asm1.status).toBe(201);
    expect(asm2.status).toBe(201);
    expect(asm3.status).toBe(201);

    const [detail1, detail2, detail3] = await Promise.all([
      request(app).get(`/api/assessments/${asm1.body.data.createdAssessments[0].id}`).set(cookieA()),
      request(app).get(`/api/assessments/${asm2.body.data.createdAssessments[0].id}`).set(cookieA()),
      request(app).get(`/api/assessments/${asm3.body.data.createdAssessments[0].id}`).set(cookieA()),
    ]);
    expect(detail1.status).toBe(200);
    expect(detail2.status).toBe(200);
    expect(detail3.status).toBe(200);

    const picked1 = extractFirstSectionVariantId(detail1.body.data);
    const picked2 = extractFirstSectionVariantId(detail2.body.data);
    const picked3 = extractFirstSectionVariantId(detail3.body.data);
    expect(picked1).toBeTruthy();
    expect(picked2).toBeTruthy();
    expect(picked3).toBeTruthy();
    expect(picked1).not.toBe(baselineVariantId);
    expect(picked2).not.toBe(baselineVariantId);
    expect(picked3).not.toBe(baselineVariantId);
    expect(picked2).not.toBe(picked1);
    expect(picked3).toBe(picked1);
  });

  it('advances cursor safely under concurrent assembly requests', async () => {
    const { courseId, topicId } = await seedUser(USER_A);
    vi.stubGlobal('fetch', sessionFetch(USER_A));

    const createQ = await request(app)
      .post('/api/questions')
      .set(cookieA())
      .send({ description: 'Concurrent assembly metadata', courseId, primaryTopicId: topicId, type: 'MCQ' });
    expect(createQ.status).toBe(201);
    const questionId = createQ.body.data.id;

    const baseline = await request(app)
      .post('/api/assessments')
      .set(cookieA())
      .send({ type: 'Quiz', name: 'Concurrent Baseline', semester: '2026W', courseId });
    expect(baseline.status).toBe(201);
    const baselineId = baseline.body.data.id;

    const section = await request(app)
      .post(`/api/assessments/${baselineId}/sections`)
      .set(cookieA())
      .send({ name: 'Exam', position: 0 });
    expect(section.status).toBe(201);
    const sectionId = section.body.data.id;

    const makeVariant = (text) =>
      request(app)
        .post(`/api/questions/${questionId}/variants`)
        .set(cookieA())
        .send({
          questionText: text,
          difficulty: 'easy',
          reasoningLevel: 'factual',
          answer: 'D',
          choices: [{ letter: 'A', text: '1' }, { letter: 'B', text: '2' }, { letter: 'C', text: '3' }, { letter: 'D', text: '4' }],
          isDraft: false,
        });

    const [refRes, altOneRes, altTwoRes] = await Promise.all([
      makeVariant('Ref A)1 B)2 C)3 D)4'),
      makeVariant('Race Alt 1 A)1 B)2 C)3 D)4'),
      makeVariant('Race Alt 2 A)1 B)2 C)3 D)4'),
    ]);
    expect(refRes.status).toBe(201);
    expect(altOneRes.status).toBe(201);
    expect(altTwoRes.status).toBe(201);

    const addRef = await request(app)
      .post(`/api/assessments/${baselineId}/sections/${sectionId}/variants`)
      .set(cookieA())
      .send({ variantId: refRes.body.data.id, displayOrder: 0 });
    expect(addRef.status).toBe(201);

    const payload = { referenceAssessmentId: baselineId, courseId, includeDrafts: false };
    const [asmA, asmB] = await Promise.all([
      request(app).post('/api/assessment-variant/assemble-variants').set(cookieA()).send({ ...payload, examLabels: ['Concurrent-A'] }),
      request(app).post('/api/assessment-variant/assemble-variants').set(cookieA()).send({ ...payload, examLabels: ['Concurrent-B'] }),
    ]);
    expect(asmA.status).toBe(201);
    expect(asmB.status).toBe(201);

    const [aDetail, bDetail] = await Promise.all([
      request(app).get(`/api/assessments/${asmA.body.data.createdAssessments[0].id}`).set(cookieA()),
      request(app).get(`/api/assessments/${asmB.body.data.createdAssessments[0].id}`).set(cookieA()),
    ]);
    expect(aDetail.status).toBe(200);
    expect(bDetail.status).toBe(200);

    const pickedA = extractFirstSectionVariantId(aDetail.body.data);
    const pickedB = extractFirstSectionVariantId(bDetail.body.data);
    expect(pickedA).toBeTruthy();
    expect(pickedB).toBeTruthy();
    expect(new Set([pickedA, pickedB]).size).toBe(2);
    expect(pickedA).not.toBe(refRes.body.data.id);
    expect(pickedB).not.toBe(refRes.body.data.id);
  });
});
