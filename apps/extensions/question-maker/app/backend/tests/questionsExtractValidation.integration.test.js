/**
 * DB-backed tests for 400 responses on POST /api/questions/extract and
 * POST /api/questions/extract/save (validation only).
 * Run: npm run test:integration (requires TEST_DATABASE_URL).
 */
import request from 'supertest';

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb('Questions extract HTTP validation (integration)', () => {
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
      .send({ email: `ext-val-${Date.now()}@local.test`, password: 'secret12' });
    expect(reg.status).toBe(201);
    token = reg.body.data.token;
  });

  afterAll(async () => {
    if (sequelize) {
      await sequelize.close();
    }
  });

  describe('POST /api/questions/extract', () => {
    it('returns 400 when text is missing', async () => {
      const res = await request(app)
        .post('/api/questions/extract')
        .set('Authorization', `Bearer ${token}`)
        .send({ courseId: 1, text: '' });
      expect(res.status).toBe(400);
      expect(String(res.body.error || '')).toMatch(/text/i);
    });

    it('returns 400 when courseId is missing', async () => {
      const res = await request(app)
        .post('/api/questions/extract')
        .set('Authorization', `Bearer ${token}`)
        .send({ text: 'Some question text for extraction' });
      expect(res.status).toBe(400);
      expect(String(res.body.error || '')).toMatch(/courseId/i);
    });

    it('returns 400 when courseId is not an integer', async () => {
      const res = await request(app)
        .post('/api/questions/extract')
        .set('Authorization', `Bearer ${token}`)
        .send({ text: 'Q?', courseId: 'nope' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/questions/extract/save', () => {
    it('returns 400 when courseId is missing', async () => {
      const res = await request(app)
        .post('/api/questions/extract/save')
        .set('Authorization', `Bearer ${token}`)
        .send({ questions: [{ description: 'Q1' }] });
      expect(res.status).toBe(400);
      expect(String(res.body.error || '')).toMatch(/courseId/i);
    });

    it('returns 400 when questions is empty', async () => {
      const res = await request(app)
        .post('/api/questions/extract/save')
        .set('Authorization', `Bearer ${token}`)
        .send({ courseId: 1, questions: [] });
      expect(res.status).toBe(400);
      expect(String(res.body.error || '')).toMatch(/question/i);
    });

    it('returns 400 when questions is not a non-empty array', async () => {
      const res = await request(app)
        .post('/api/questions/extract/save')
        .set('Authorization', `Bearer ${token}`)
        .send({ courseId: 1, questions: 'not-an-array' });
      expect(res.status).toBe(400);
    });
  });
});
