/**
 * DB-backed RBAC tests for the course routes (rbac-matrix §3/§5).
 *
 * Verifies the per-course access gate now used across /api/course/:id:
 *   - GET /api/course/:id/access resolves the caller's level for UI gating
 *     (this is what fixes the "You do not have access to this course" banner
 *     wrongly shown to ADMIN — the route previously did not exist, so the
 *     client always fell back to null access).
 *   - ADMIN reaches any course (not just ones they own); a non-owner without
 *     access gets 403, and a missing course gets 404.
 *
 * The seeded fixture courses are Core-linked (fake coreCourseId), but the shared
 * `multiUserFetch` stub below only answers session validation, so any Core
 * enrollment lookup resolves to an empty roster — access still resolves via the
 * owner-fallback / ADMIN rules in resolveAccessForCourse. Auth is stubbed via
 * global fetch (session validate).
 * Requires TEST_DATABASE_URL — see docs/TEST_PLAN.md. Run: npm run test:integration
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import request from 'supertest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const { default: app } = await import('../../src/app.js');

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

const OWNER = { id: 'cuid-rbac-owner', email: 'owner@test.com', role: 'INSTRUCTOR', name: 'Owner' };
const STRANGER = { id: 'cuid-rbac-stranger', email: 'stranger@test.com', role: 'INSTRUCTOR', name: 'Stranger' };
const ADMIN = { id: 'cuid-rbac-admin', email: 'admin@test.com', role: 'ADMIN', name: 'Admin' };

/** Routes the session-validate fetch to a user based on the cookie value. */
function multiUserFetch() {
  return vi.fn().mockImplementation((_url, opts) => {
    const cookie = opts?.headers?.cookie ?? '';
    const user = cookie.includes('owner')
      ? OWNER
      : cookie.includes('admin')
        ? ADMIN
        : STRANGER;
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ user }) });
  });
}

const asOwner = () => ({ Cookie: 'session=owner' });
const asStranger = () => ({ Cookie: 'session=stranger' });
const asAdmin = () => ({ Cookie: 'session=admin' });

describeDb('course RBAC (integration)', () => {
  let connectTestDatabase, truncateTestDatabase, sequelize;
  let User, Course;
  let seedCoursesForNewUser;
  let courseId;

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    ({ connectTestDatabase, truncateTestDatabase, sequelize } = testDb);
    await connectTestDatabase();

    const schema = await import('../../src/schema/index.js');
    ({ User, Course } = schema);
    ({ seedCoursesForNewUser } = await import('../helpers/seedCoursesFixture.js'));
  });

  beforeEach(async () => {
    await truncateTestDatabase();
    await User.create({ id: OWNER.id, email: OWNER.email, name: OWNER.name });
    await User.create({ id: STRANGER.id, email: STRANGER.email, name: STRANGER.name });
    await User.create({ id: ADMIN.id, email: ADMIN.email, name: ADMIN.name });
    await seedCoursesForNewUser(OWNER.id);
    const course = await Course.findOne({ where: { userId: OWNER.id } });
    courseId = course.id;

    vi.stubGlobal('fetch', multiUserFetch());
  });

  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    if (sequelize) await sequelize.close();
  });

  describe('GET /api/course/:id/access', () => {
    it('returns instructor level for the owner', async () => {
      const res = await request(app).get(`/api/course/${courseId}/access`).set(asOwner());
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ level: 'instructor', rank: 2 });
    });

    it('returns admin level for an ADMIN on a course they do not own', async () => {
      const res = await request(app).get(`/api/course/${courseId}/access`).set(asAdmin());
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ level: 'admin', rank: 4 });
    });

    it('returns null data (not 403) when the caller has no access', async () => {
      const res = await request(app).get(`/api/course/${courseId}/access`).set(asStranger());
      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });

    it('returns 404 for a non-existent course', async () => {
      const res = await request(app).get('/api/course/0/access').set(asOwner());
      expect(res.status).toBe(404);
    });
  });

  describe('per-course gate on /api/course/:id', () => {
    it('lets an ADMIN view a course they do not own', async () => {
      const res = await request(app).get(`/api/course/${courseId}`).set(asAdmin());
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(courseId);
    });

    it('lets an ADMIN edit a course they do not own', async () => {
      const res = await request(app)
        .put(`/api/course/${courseId}`)
        .set(asAdmin())
        .send({ name: 'Renamed by admin' });
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(courseId);

      // The fixture course is Core-linked, so the *response* name is projected
      // from Core (read-through, #1072 §3) — not the local column just written.
      // Assert the RBAC-gated write itself landed, rather than the unrelated
      // Core-projection behavior.
      const updated = await Course.findByPk(courseId);
      expect(updated.name).toBe('Renamed by admin');
    });

    it('rejects a non-owner without access with 403', async () => {
      const res = await request(app).get(`/api/course/${courseId}`).set(asStranger());
      expect(res.status).toBe(403);
    });

    it('rejects a non-owner edit with 403', async () => {
      const res = await request(app)
        .put(`/api/course/${courseId}`)
        .set(asStranger())
        .send({ name: 'Hijack' });
      expect(res.status).toBe(403);
    });
  });
});
