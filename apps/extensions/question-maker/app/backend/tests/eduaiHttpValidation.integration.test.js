/**
 * DB-backed 400s on /api/eduai routes (body validation only; no EduAI HTTP).
 * Run: npm run test:integration (requires TEST_DATABASE_URL).
 */
import request from 'supertest';

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb('EduAI HTTP validation (integration)', () => {
  let app;
  let connectTestDatabase;
  let truncateTestDatabase;
  let sequelize;
  let token;

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
      .send({ email: `eduai-val-${Date.now()}@local.test`, password: 'secret12' });
    expect(reg.status).toBe(201);
    token = reg.body.data.token;
  });

  afterAll(async () => {
    if (sequelize) {
      await sequelize.close();
    }
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  describe('POST /api/eduai/chat', () => {
    it('returns 400 when messages is missing', async () => {
      const res = await request(app)
        .post('/api/eduai/chat')
        .set(auth())
        .send({ courseCode: 'COSC_101' });
      expect(res.status).toBe(400);
      expect(String(res.body.error || '')).toMatch(/[Mm]essage/i);
    });

    it('returns 400 when courseCode is missing', async () => {
      const res = await request(app)
        .post('/api/eduai/chat')
        .set(auth())
        .send({ messages: [{ role: 'user', content: 'Hello' }] });
      expect(res.status).toBe(400);
      expect(String(res.body.error || '')).toMatch(/course/i);
    });
  });

  describe('POST /api/eduai/generate-questions', () => {
    it('returns 400 when prompt is missing', async () => {
      const res = await request(app)
        .post('/api/eduai/generate-questions')
        .set(auth())
        .send({ courseCode: 'TEST' });
      expect(res.status).toBe(400);
      expect(String(res.body.error || '')).toMatch(/[Pp]rompt|required/i);
    });

    it('returns 400 when courseCode is missing', async () => {
      const res = await request(app)
        .post('/api/eduai/generate-questions')
        .set(auth())
        .send({ prompt: 'Write one MCQ' });
      expect(res.status).toBe(400);
      expect(String(res.body.error || '')).toMatch(/[Cc]ourse|required/i);
    });
  });
});
