/**
 * DB-backed tests for /api/auth. Requires PostgreSQL and TEST_DATABASE_URL in project root .env
 * (see docs/TEST_PLAN.md). Run: npm run test:integration
 */
import request from 'supertest';

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb('Auth API (integration)', () => {
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

  it('rejects register when password is too short', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'a@b.co', password: '12345' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects register when email or password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'a@b.co' });
    expect(res.status).toBe(400);
  });

  it('registers, logs in, and returns 200 for GET /me', async () => {
    const email = 'integration-auth@local.test';
    const password = 'secret12';

    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password });
    expect(reg.status).toBe(201);
    expect(reg.body.data.token).toBeTruthy();
    expect(reg.body.data.user.email).toBe(email);

    const loginOk = await request(app)
      .post('/api/auth/login')
      .send({ email, password });
    expect(loginOk.status).toBe(200);
    expect(loginOk.body.data.token).toBeTruthy();
    expect(loginOk.body.data.user.email).toBe(email);

    const meNoAuth = await request(app).get('/api/auth/me');
    expect(meNoAuth.status).toBe(401);

    const token = reg.body.data.token;
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(email);

    const badLogin = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'wrong-password' });
    expect(badLogin.status).toBe(500);
  });

  it('rejects login for an unknown email with a generic error', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'no-such-user@local.test', password: 'secret12' });
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(String(res.body.error || '')).toMatch(/invalid|password|email/i);
  });

  it('returns error when email is already registered', async () => {
    const email = 'dup@local.test';
    const password = 'secret12';
    const first = await request(app)
      .post('/api/auth/register')
      .send({ email, password });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/auth/register')
      .send({ email, password });
    expect(second.status).toBe(500);
    expect(String(second.body.error || '')).toMatch(/exists/i);
  });
});
