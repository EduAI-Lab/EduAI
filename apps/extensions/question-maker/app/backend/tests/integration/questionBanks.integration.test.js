/**
 * DB-backed tests for question banks (M2M membership) and Canvas bank sync.
 * Requires TEST_DATABASE_URL — see docs/TEST_PLAN.md.
 */
import request from 'supertest';

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb('Question banks + Canvas bank sync (integration)', () => {
  let app;
  let truncateTestDatabase;
  let connectTestDatabase;
  let sequelize;
  let authToken;
  let courseId;
  let topicId;

  beforeAll(async () => {
    if (!hasTestDb) return;
    const { default: appMod } = await import('../../src/app.js');
    const testDb = await import('../helpers/testDb.js');
    app = appMod;
    connectTestDatabase = testDb.connectTestDatabase;
    truncateTestDatabase = testDb.truncateTestDatabase;
    ({ sequelize } = testDb);
    await connectTestDatabase();
  }, 60000);

  beforeEach(async () => {
    if (!hasTestDb) return;
    await truncateTestDatabase();

    const reg = await request(app)
      .post('/api/auth/register')
      .send({
        email: `banks-${Date.now()}@local.test`,
        password: 'secret12'
      });
    expect(reg.status).toBe(201);
    authToken = reg.body.data.token;

    const coursesRes = await request(app)
      .get('/api/course')
      .set('Authorization', `Bearer ${authToken}`);
    courseId = coursesRes.body.data[0].id;

    const topicsRes = await request(app)
      .get(`/api/course/${courseId}/topics`)
      .set('Authorization', `Bearer ${authToken}`);
    topicId = topicsRes.body.data[0].id;
  });

  afterAll(async () => {
    if (sequelize) await sequelize.close();
  });

  it('lists a default bank for a seeded course', async () => {
    const res = await request(app)
      .get(`/api/course/${courseId}/banks`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.some((b) => b.isDefault)).toBe(true);
  });

  it('supports multi-bank membership for the same question', async () => {
    const banksRes = await request(app)
      .get(`/api/course/${courseId}/banks`)
      .set('Authorization', `Bearer ${authToken}`);
    const defaultBank = banksRes.body.data.find((b) => b.isDefault);

    const createBank = await request(app)
      .post(`/api/course/${courseId}/banks`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Extra bank' });
    expect(createBank.status).toBe(201);
    const extraBankId = createBank.body.data.id;

    const createQ = await request(app)
      .post('/api/questions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        description: 'Shared question',
        courseId,
        primaryTopicId: topicId,
        type: 'SA',
        questionBankId: defaultBank.id
      });
    expect(createQ.status).toBe(201);
    const qid = createQ.body.data.id;

    const add = await request(app)
      .post(`/api/course/${courseId}/banks/${extraBankId}/questions`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ questionMetadataId: qid });
    expect([200, 201]).toContain(add.status);

    const inDefault = await request(app)
      .get('/api/questions')
      .query({ courseId, questionBankId: defaultBank.id })
      .set('Authorization', `Bearer ${authToken}`);
    const inExtra = await request(app)
      .get('/api/questions')
      .query({ courseId, questionBankId: extraBankId })
      .set('Authorization', `Bearer ${authToken}`);

    expect(inDefault.body.data.some((q) => q.id === qid)).toBe(true);
    expect(inExtra.body.data.some((q) => q.id === qid)).toBe(true);

    const courseWide = await request(app)
      .get('/api/questions')
      .query({ courseId })
      .set('Authorization', `Bearer ${authToken}`);
    const matches = courseWide.body.data.filter((q) => q.id === qid);
    expect(matches.length).toBe(1);
  });

  it('cannot delete the default bank', async () => {
    const banksRes = await request(app)
      .get(`/api/course/${courseId}/banks`)
      .set('Authorization', `Bearer ${authToken}`);
    const defaultBank = banksRes.body.data.find((b) => b.isDefault);

    const del = await request(app)
      .delete(`/api/course/${courseId}/banks/${defaultBank.id}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(del.status).toBe(400);
  });

  it('syncs a Canvas bank in test mode and re-syncs without duplicates', async () => {
    await request(app)
      .post('/api/canvas/connect')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        canvasUrl: 'https://canvas.test',
        isTestMode: true
      });

    const first = await request(app)
      .post('/api/canvas/import/1/banks/10')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ localCourseId: courseId, primaryTopicId: topicId });
    expect(first.status).toBe(200);
    expect(first.body.data.created).toBeGreaterThan(0);
    const bankId = first.body.data.bankId;
    const created = first.body.data.created;

    const second = await request(app)
      .post('/api/canvas/import/1/banks/10')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ localCourseId: courseId, primaryTopicId: topicId, targetBankId: bankId });
    expect(second.status).toBe(200);
    expect(second.body.data.created).toBe(0);
    expect(second.body.data.updated).toBe(created);

    const list = await request(app)
      .get('/api/questions')
      .query({ courseId, questionBankId: bankId })
      .set('Authorization', `Bearer ${authToken}`);
    expect(list.body.data.length).toBe(created);
  });
});
