/**
 * DB-backed tests for 400 responses on /api/assessment-variant (validation before heavy work).
 * Run: npm run test:integration (requires TEST_DATABASE_URL).
 */
import request from 'supertest';

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb('Assessment variant API validation (integration)', () => {
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
      .send({ email: `av-val-${Date.now()}@local.test`, password: 'secret12' });
    expect(reg.status).toBe(201);
    token = reg.body.data.token;
  });

  afterAll(async () => {
    if (sequelize) {
      await sequelize.close();
    }
  });

  it('returns 400 when PATCH /role has no studyRole in body', async () => {
    const res = await request(app)
      .patch('/api/assessment-variant/assessments/1/role')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when GET variant-readiness is missing courseId', async () => {
    const res = await request(app)
      .get('/api/assessment-variant/assessments/1/variant-readiness')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(String(res.body.error || '')).toMatch(/courseId/i);
  });

  it('returns 400 when POST assemble-variants is missing required ids', async () => {
    const res = await request(app)
      .post('/api/assessment-variant/assemble-variants')
      .set('Authorization', `Bearer ${token}`)
      .send({ referenceAssessmentId: 1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when POST assemble-by-metadata is missing required ids', async () => {
    const res = await request(app)
      .post('/api/assessment-variant/assemble-by-metadata')
      .set('Authorization', `Bearer ${token}`)
      .send({ courseId: 1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when POST generate-bank-variants has empty questionIds', async () => {
    const res = await request(app)
      .post('/api/assessment-variant/generate-bank-variants')
      .set('Authorization', `Bearer ${token}`)
      .send({ courseId: 1, questionIds: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when POST review-variant-ai is missing required ids', async () => {
    const res = await request(app)
      .post('/api/assessment-variant/review-variant-ai')
      .set('Authorization', `Bearer ${token}`)
      .send({ baselineAssessmentId: 1, courseId: 1 });
    expect(res.status).toBe(400);
  });
});
