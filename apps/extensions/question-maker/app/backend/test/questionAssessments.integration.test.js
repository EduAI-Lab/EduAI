/**
 * DB-backed tests for /api/questions and /api/assessments (happy paths).
 * Requires TEST_DATABASE_URL — see docs/TEST_PLAN.md. Run: npm run test:integration
 */
import request from 'supertest';

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb('Questions & assessments (integration)', () => {
  let app;
  let truncateTestDatabase;
  let connectTestDatabase;
  let sequelize;

  let authToken;
  let courseId;
  let topicId;

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

  beforeEach(async () => {
    if (!hasTestDb) {
      return;
    }
    await truncateTestDatabase();

    const reg = await request(app)
      .post('/api/auth/register')
      .send({
        email: `qna-${Date.now()}@local.test`,
        password: 'secret12'
      });
    if (reg.status !== 201) {
      throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    }
    authToken = reg.body.data.token;

    const coursesRes = await request(app)
      .get('/api/course')
      .set('Authorization', `Bearer ${authToken}`);
    if (!coursesRes.body.data?.length) {
      throw new Error('expected seeded courses for new user');
    }
    courseId = coursesRes.body.data[0].id;

    const topicsRes = await request(app)
      .get(`/api/course/${courseId}/topics`)
      .set('Authorization', `Bearer ${authToken}`);
    if (!topicsRes.body.data?.length) {
      throw new Error('expected topics on seeded course');
    }
    topicId = topicsRes.body.data[0].id;
  });

  afterAll(async () => {
    if (sequelize) {
      await sequelize.close();
    }
  });

  it('creates a question and lists it in GET /api/questions', async () => {
    const create = await request(app)
      .post('/api/questions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        description: 'Integration test question',
        courseId,
        primaryTopicId: topicId,
        type: 'MCQ'
      });
    expect(create.status).toBe(201);
    expect(create.body.data.id).toBeTruthy();

    const list = await request(app)
      .get('/api/questions')
      .set('Authorization', `Bearer ${authToken}`);
    expect(list.status).toBe(200);
    const rows = list.body.data;
    const found = rows.some((q) => q.id === create.body.data.id);
    expect(found).toBe(true);
  });

  it('creates an assessment and fetches it by id', async () => {
    const createA = await request(app)
      .post('/api/assessments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        type: 'Quiz',
        name: 'Integration Exam',
        semester: 'Fall 2026',
        courseId
      });
    expect(createA.status).toBe(201);
    const id = createA.body.data.id;

    const getOne = await request(app)
      .get(`/api/assessments/${id}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(getOne.status).toBe(200);
    expect(getOne.body.data.name).toBe('Integration Exam');
    expect(getOne.body.data.courseId).toBe(courseId);
  });

  it('rejects a question with invalid type', async () => {
    const res = await request(app)
      .post('/api/questions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        description: 'X',
        courseId,
        primaryTopicId: topicId,
        type: 'TF'
      });
    expect(res.status).toBe(400);
  });

  it('rejects a question when primaryTopicId is missing or invalid', async () => {
    const res = await request(app)
      .post('/api/questions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        description: 'X',
        courseId,
        primaryTopicId: 'not-a-number',
        type: 'MCQ'
      });
    expect(res.status).toBe(400);
  });

  it('creates a course via POST and sees it in GET /api/course', async () => {
    const name = 'Custom Integration Course';
    const created = await request(app)
      .post('/api/course')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name, courseCode: 'INT-999' });
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe(name);

    const list = await request(app)
      .get('/api/course')
      .set('Authorization', `Bearer ${authToken}`);
    const found = list.body.data.some((c) => c.id === created.body.data.id && c.name === name);
    expect(found).toBe(true);
  });

  it('creates a question, adds a variant, and lists variants', async () => {
    const createQ = await request(app)
      .post('/api/questions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        description: 'Variant parent',
        courseId,
        primaryTopicId: topicId,
        type: 'MCQ'
      });
    expect(createQ.status).toBe(201);
    const qid = createQ.body.data.id;

    const getSeedAssessment = await request(app)
      .get('/api/assessments')
      .set('Authorization', `Bearer ${authToken}`)
      .query({ courseId });
    expect(getSeedAssessment.status).toBe(200);
    const practice = getSeedAssessment.body.data.find((a) => a.name === 'Practice Exam');
    expect(practice).toBeTruthy();
    const assessmentId = practice.id;

    const v = await request(app)
      .post(`/api/questions/${qid}/variants`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        questionText: 'What is 2+2?',
        difficulty: 'easy',
        reasoningLevel: 'factual',
        assessmentId,
        answer: 'A',
        choices: [
          { letter: 'A', text: '4' },
          { letter: 'B', text: '5' }
        ],
        isDraft: false
      });
    expect(v.status).toBe(201);
    expect(v.body.data.id).toBeTruthy();

    const listV = await request(app)
      .get(`/api/questions/${qid}/variants`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(listV.status).toBe(200);
    expect(Array.isArray(listV.body.data)).toBe(true);
    expect(listV.body.data.length).toBeGreaterThan(0);
  });

  it('returns 400 when variant has empty questionText', async () => {
    const createQ = await request(app)
      .post('/api/questions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        description: 'No variant text test',
        courseId,
        primaryTopicId: topicId,
        type: 'MCQ'
      });
    const qid = createQ.body.data.id;

    const res = await request(app)
      .post(`/api/questions/${qid}/variants`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ questionText: '   ' });
    expect(res.status).toBe(400);
  });
});
