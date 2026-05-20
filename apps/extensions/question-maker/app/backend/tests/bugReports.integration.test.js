/**
 * DB-backed tests for /api/bug-reports. Requires PostgreSQL and TEST_DATABASE_URL (see docs/TEST_PLAN.md).
 */
import request from 'supertest';

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb('Bug reports API (integration)', () => {
  let app;
  let truncateTestDatabase;
  let connectTestDatabase;
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

  beforeEach(async () => {
    if (!hasTestDb) {
      return;
    }
    await truncateTestDatabase();
  });

  afterAll(async () => {
    if (sequelize) {
      await sequelize.close();
    }
  });

  it('rejects POST without auth', async () => {
    const res = await request(app).post('/api/bug-reports').send({
      description: 'Something failed here ok'
    });
    expect(res.status).toBe(401);
  });

  it('creates a bug report when authenticated', async () => {
    const email = `reporter-${Date.now()}@local.test`;
    const password = 'secret12';

    const reg = await request(app).post('/api/auth/register').send({ email, password });
    expect(reg.status).toBe(201);
    const token = reg.body.data.token;

    const res = await request(app)
      .post('/api/bug-reports')
      .set('Authorization', `Bearer ${token}`)
      .send({
        description: 'Steps: open page, click save, error shows.',
        consoleLogs: '[]',
        networkLogs: '[]',
        screenshot: null,
        pageUrl: 'http://localhost/home',
        userAgent: 'jest',
        isAnonymous: false
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeTruthy();
  });

  it('rejects GET list for non-admin user', async () => {
    const email = `user-${Date.now()}@local.test`;
    const reg = await request(app).post('/api/auth/register').send({ email, password: 'secret12' });
    const token = reg.body.data.token;

    const res = await request(app).get('/api/bug-reports').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('allows admin to list and patch status', async () => {
    const adminEmail = 'admin@mail.com';
    const adminReg = await request(app)
      .post('/api/auth/register')
      .send({ email: adminEmail, password: 'secret12' });
    expect(adminReg.status).toBe(201);
    const adminToken = adminReg.body.data.token;

    const reporterReg = await request(app)
      .post('/api/auth/register')
      .send({ email: `rep-${Date.now()}@local.test`, password: 'secret12' });
    const repToken = reporterReg.body.data.token;

    const create = await request(app)
      .post('/api/bug-reports')
      .set('Authorization', `Bearer ${repToken}`)
      .send({
        description: 'Another bug description here.',
        consoleLogs: '[{"level":"log","message":"hi","timestamp":"2020-01-01T00:00:00.000Z"}]',
        networkLogs: '[]',
        pageUrl: 'http://localhost/x',
        userAgent: 'jest',
        isAnonymous: true
      });
    expect(create.status).toBe(201);
    const bugId = create.body.data.id;

    const list = await request(app).get('/api/bug-reports').set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);
    expect(list.body.data.some((b) => b.id === bugId)).toBe(true);

    const patch = await request(app)
      .patch(`/api/bug-reports/${bugId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'in progress' });
    expect(patch.status).toBe(200);
    expect(patch.body.data.status).toBe('in progress');
  });
});
