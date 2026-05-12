/**
 * DB-backed tests that close remaining TEST_PLAN gaps: cross-user course access,
 * extract/save persistence, and assessment variant assembly.
 * Run: npm run test:integration (requires TEST_DATABASE_URL).
 */
import request from 'supertest';

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb('Plan coverage (integration)', () => {
  let app;
  let connectTestDatabase;
  let truncateTestDatabase;
  let sequelize;

  beforeAll(async () => {
    if (!hasTestDb) {
      return;
    }
    const { default: appMod } = await import('../src/app.js');
    const testDb = await import('./helpers/testDb.js');
    app = appMod;
    connectTestDatabase = testDb.connectTestDatabase;
    truncateTestDatabase = testDb.truncateTestDatabase;
    ({ sequelize } = testDb);
    await connectTestDatabase();
  });

  afterAll(async () => {
    if (sequelize) {
      await sequelize.close();
    }
  });

  beforeEach(async () => {
    if (!hasTestDb) {
      return;
    }
    await truncateTestDatabase();
  });

  const extractFirstSectionVariantId = (assessment) =>
    assessment?.sections?.[0]?.sectionVariants?.[0]?.variant?.id ?? null;

  it('returns 404 when fetching another user course by id', async () => {
    const reg1 = await request(app)
      .post('/api/auth/register')
      .send({ email: `user-a-${Date.now()}@local.test`, password: 'secret12' });
    expect(reg1.status).toBe(201);
    const token1 = reg1.body.data.token;
    const courses1 = await request(app)
      .get('/api/course')
      .set('Authorization', `Bearer ${token1}`);
    const courseIdA = courses1.body.data[0].id;

    const reg2 = await request(app)
      .post('/api/auth/register')
      .send({ email: `user-b-${Date.now()}@local.test`, password: 'secret12' });
    expect(reg2.status).toBe(201);
    const token2 = reg2.body.data.token;

    const res = await request(app)
      .get(`/api/course/${courseIdA}`)
      .set('Authorization', `Bearer ${token2}`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('persists extracted questions via POST /api/questions/extract/save', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: `save-ext-${Date.now()}@local.test`, password: 'secret12' });
    expect(reg.status).toBe(201);
    const token = reg.body.data.token;
    const courses = await request(app)
      .get('/api/course')
      .set('Authorization', `Bearer ${token}`);
    const courseId = courses.body.data[0].id;
    const topics = await request(app)
      .get(`/api/course/${courseId}/topics`)
      .set('Authorization', `Bearer ${token}`);
    const topicId = topics.body.data[0].id;

    const res = await request(app)
      .post('/api/questions/extract/save')
      .set('Authorization', `Bearer ${token}`)
      .send({
        courseId,
        primaryTopicId: topicId,
        questions: [
          {
            question: 'What is 2+2?',
            summary: 'Single-digit addition',
            type: 'SA',
            difficulty: 'easy',
            answer: '4',
          },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(1);
  });

  it('assembles a variant exam from the Practice Exam via assemble-variants', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: `asm-var-${Date.now()}@local.test`, password: 'secret12' });
    expect(reg.status).toBe(201);
    const token = reg.body.data.token;
    const courses = await request(app)
      .get('/api/course')
      .set('Authorization', `Bearer ${token}`);
    const courseId = courses.body.data[0].id;
    const topics = await request(app)
      .get(`/api/course/${courseId}/topics`)
      .set('Authorization', `Bearer ${token}`);
    const topicId = topics.body.data[0].id;

    const createQ = await request(app)
      .post('/api/questions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        description: 'Assembly baseline metadata',
        courseId,
        primaryTopicId: topicId,
        type: 'MCQ',
      });
    expect(createQ.status).toBe(201);
    const qid = createQ.body.data.id;

    const alist = await request(app)
      .get('/api/assessments')
      .set('Authorization', `Bearer ${token}`)
      .query({ courseId });
    const practice = alist.body.data.find((a) => a.name === 'Practice Exam');
    expect(practice).toBeTruthy();
    const assessmentId = practice.id;

    const v = await request(app)
      .post(`/api/questions/${qid}/variants`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        questionText: 'What is 2+2? A)1 B)2 C)3 D)4',
        difficulty: 'easy',
        reasoningLevel: 'factual',
        assessmentId,
        answer: 'D',
        choices: [
          { letter: 'A', text: '1' },
          { letter: 'B', text: '2' },
          { letter: 'C', text: '3' },
          { letter: 'D', text: '4' },
        ],
        isDraft: false,
      });
    expect(v.status).toBe(201);

    const asm = await request(app)
      .post('/api/assessment-variant/assemble-variants')
      .set('Authorization', `Bearer ${token}`)
      .send({
        referenceAssessmentId: practice.id,
        courseId,
        examLabels: ['Assembled-Integration'],
        includeDrafts: true,
      });
    expect(asm.status).toBe(201);
    expect(asm.body.success).toBe(true);
    expect(asm.body.data.createdAssessments.length).toBe(1);
    expect(asm.body.data.slotsProcessed).toBeGreaterThan(0);
  });

  it('rotates slot variant picks fairly across runs and avoids baseline when alternatives exist', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: `asm-rr-${Date.now()}@local.test`, password: 'secret12' });
    expect(reg.status).toBe(201);
    const token = reg.body.data.token;

    const courses = await request(app)
      .get('/api/course')
      .set('Authorization', `Bearer ${token}`);
    const courseId = courses.body.data[0].id;

    const topics = await request(app)
      .get(`/api/course/${courseId}/topics`)
      .set('Authorization', `Bearer ${token}`);
    const topicId = topics.body.data[0].id;

    const createQ = await request(app)
      .post('/api/questions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        description: 'Round-robin assembly metadata',
        courseId,
        primaryTopicId: topicId,
        type: 'MCQ'
      });
    expect(createQ.status).toBe(201);
    const questionId = createQ.body.data.id;

    const createBaseline = await request(app)
      .post('/api/assessments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'Quiz',
        name: 'RR Baseline',
        semester: '2026W',
        courseId
      });
    expect(createBaseline.status).toBe(201);
    const baselineId = createBaseline.body.data.id;

    const createSection = await request(app)
      .post(`/api/assessments/${baselineId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Exam', position: 0 });
    expect(createSection.status).toBe(201);
    const sectionId = createSection.body.data.id;

    const createVariant = async (text) =>
      request(app)
        .post(`/api/questions/${questionId}/variants`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          questionText: text,
          difficulty: 'easy',
          reasoningLevel: 'factual',
          answer: 'D',
          choices: [
            { letter: 'A', text: '1' },
            { letter: 'B', text: '2' },
            { letter: 'C', text: '3' },
            { letter: 'D', text: '4' }
          ],
          isDraft: false
        });

    const baselineVariantRes = await createVariant('Baseline stem A)1 B)2 C)3 D)4');
    const altOneRes = await createVariant('Alternate 1 A)1 B)2 C)3 D)4');
    const altTwoRes = await createVariant('Alternate 2 A)1 B)2 C)3 D)4');
    expect(baselineVariantRes.status).toBe(201);
    expect(altOneRes.status).toBe(201);
    expect(altTwoRes.status).toBe(201);

    const baselineVariantId = baselineVariantRes.body.data.id;
    const addToSection = await request(app)
      .post(`/api/assessments/${baselineId}/sections/${sectionId}/variants`)
      .set('Authorization', `Bearer ${token}`)
      .send({ variantId: baselineVariantId, displayOrder: 0 });
    expect(addToSection.status).toBe(201);

    const assembleOnce = async (label) =>
      request(app)
        .post('/api/assessment-variant/assemble-variants')
        .set('Authorization', `Bearer ${token}`)
        .send({
          referenceAssessmentId: baselineId,
          courseId,
          examLabels: [label],
          includeDrafts: false
        });

    const asm1 = await assembleOnce('RR-1');
    const asm2 = await assembleOnce('RR-2');
    const asm3 = await assembleOnce('RR-3');
    expect(asm1.status).toBe(201);
    expect(asm2.status).toBe(201);
    expect(asm3.status).toBe(201);

    const asm1Id = asm1.body.data.createdAssessments[0].id;
    const asm2Id = asm2.body.data.createdAssessments[0].id;
    const asm3Id = asm3.body.data.createdAssessments[0].id;

    const detail1 = await request(app).get(`/api/assessments/${asm1Id}`).set('Authorization', `Bearer ${token}`);
    const detail2 = await request(app).get(`/api/assessments/${asm2Id}`).set('Authorization', `Bearer ${token}`);
    const detail3 = await request(app).get(`/api/assessments/${asm3Id}`).set('Authorization', `Bearer ${token}`);
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
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: `asm-race-${Date.now()}@local.test`, password: 'secret12' });
    expect(reg.status).toBe(201);
    const token = reg.body.data.token;

    const courses = await request(app)
      .get('/api/course')
      .set('Authorization', `Bearer ${token}`);
    const courseId = courses.body.data[0].id;

    const topics = await request(app)
      .get(`/api/course/${courseId}/topics`)
      .set('Authorization', `Bearer ${token}`);
    const topicId = topics.body.data[0].id;

    const createQ = await request(app)
      .post('/api/questions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        description: 'Concurrent assembly metadata',
        courseId,
        primaryTopicId: topicId,
        type: 'MCQ'
      });
    expect(createQ.status).toBe(201);
    const questionId = createQ.body.data.id;

    const baseline = await request(app)
      .post('/api/assessments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'Quiz',
        name: 'Concurrent Baseline',
        semester: '2026W',
        courseId
      });
    expect(baseline.status).toBe(201);
    const baselineId = baseline.body.data.id;

    const section = await request(app)
      .post(`/api/assessments/${baselineId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Exam', position: 0 });
    expect(section.status).toBe(201);
    const sectionId = section.body.data.id;

    const makeVariant = async (text) =>
      request(app)
        .post(`/api/questions/${questionId}/variants`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          questionText: text,
          difficulty: 'easy',
          reasoningLevel: 'factual',
          answer: 'D',
          choices: [
            { letter: 'A', text: '1' },
            { letter: 'B', text: '2' },
            { letter: 'C', text: '3' },
            { letter: 'D', text: '4' }
          ],
          isDraft: false
        });

    const refRes = await makeVariant('Ref A)1 B)2 C)3 D)4');
    const altOneRes = await makeVariant('Race Alt 1 A)1 B)2 C)3 D)4');
    const altTwoRes = await makeVariant('Race Alt 2 A)1 B)2 C)3 D)4');
    expect(refRes.status).toBe(201);
    expect(altOneRes.status).toBe(201);
    expect(altTwoRes.status).toBe(201);

    const addRef = await request(app)
      .post(`/api/assessments/${baselineId}/sections/${sectionId}/variants`)
      .set('Authorization', `Bearer ${token}`)
      .send({ variantId: refRes.body.data.id, displayOrder: 0 });
    expect(addRef.status).toBe(201);

    const payload = {
      referenceAssessmentId: baselineId,
      courseId,
      includeDrafts: false
    };

    const [asmA, asmB] = await Promise.all([
      request(app)
        .post('/api/assessment-variant/assemble-variants')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...payload, examLabels: ['Concurrent-A'] }),
      request(app)
        .post('/api/assessment-variant/assemble-variants')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...payload, examLabels: ['Concurrent-B'] })
    ]);
    expect(asmA.status).toBe(201);
    expect(asmB.status).toBe(201);

    const aId = asmA.body.data.createdAssessments[0].id;
    const bId = asmB.body.data.createdAssessments[0].id;
    const [aDetail, bDetail] = await Promise.all([
      request(app).get(`/api/assessments/${aId}`).set('Authorization', `Bearer ${token}`),
      request(app).get(`/api/assessments/${bId}`).set('Authorization', `Bearer ${token}`)
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
