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
 * The seeded fixture courses are Core-linked (fake coreCourseId). After #1114,
 * access requires Core enrollment/unit data (fail closed) — stubs answer with
 * a teaching enrollment for the owner via `teachingInstructorFetch`.
 * Requires TEST_DATABASE_URL — see docs/TEST_PLAN.md. Run: npm run test:integration
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import { teachingInstructorFetch } from '../helpers/teachingInstructorFetch.js';

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
function multiUserHandlers(ownerFetch) {
  return async (url, opts) => {
    const target = String(url);
    const path = target.split('?')[0];
    const cookie = opts?.headers?.cookie ?? '';

    if (path.endsWith('/api/sessions/validate')) {
      const user = cookie.includes('owner')
        ? OWNER
        : cookie.includes('admin')
          ? ADMIN
          : STRANGER;
      return { ok: true, json: async () => ({ user }) };
    }

    // Stranger has no teaching enrollment on the owner's course.
    if (cookie.includes('stranger') && /\/enrollments$/.test(path)) {
      return { ok: true, json: async () => ({ enrollments: [] }) };
    }

    // ADMIN short-circuits in resolveAccessForCourse — enrollment unused.
    // Owner uses the teaching stub.
    return ownerFetch(url, opts);
  };
}

const asOwner = () => ({ Cookie: 'session=owner' });
const asStranger = () => ({ Cookie: 'session=stranger' });
const asAdmin = () => ({ Cookie: 'session=admin' });

describeDb('course RBAC (integration)', () => {
  let connectTestDatabase, truncateTestDatabase, prisma;
  let seedCoursesForNewUser;
  let courseId;

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    ({ connectTestDatabase, truncateTestDatabase, prisma } = testDb);
    await connectTestDatabase();

    ({ seedCoursesForNewUser } = await import('../helpers/seedCoursesFixture.js'));
  });

  beforeEach(async () => {
    await truncateTestDatabase();
    await prisma.user.create({ data: { id: OWNER.id, email: OWNER.email, name: OWNER.name } });
    await prisma.user.create({ data: { id: STRANGER.id, email: STRANGER.email, name: STRANGER.name } });
    await prisma.user.create({ data: { id: ADMIN.id, email: ADMIN.email, name: ADMIN.name } });
    await seedCoursesForNewUser(OWNER.id);
    const course = await prisma.course.findFirst({ where: { userId: OWNER.id } });
    courseId = course.id;

    const ownerFetch = await teachingInstructorFetch(OWNER, prisma);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(multiUserHandlers(ownerFetch)));
  });

  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
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

    it('lets an ADMIN pass the per-course edit gate for a course they do not own', async () => {
      // `name`/`code` are Core-owned and no longer stored locally (#1072 §4
      // step 10) — PUT has nothing left to write, so this only asserts the
      // RBAC gate itself (an ADMIN reaches the route and gets the course back).
      const res = await request(app)
        .put(`/api/course/${courseId}`)
        .set(asAdmin())
        .send({ name: 'Renamed by admin' });
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(courseId);
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

    it('rejects the owner with 403 when Core enrollment fetch fails (#1114)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url, opts) => {
          const path = String(url).split('?')[0];
          if (path.endsWith('/api/sessions/validate')) {
            return Promise.resolve({ ok: true, json: async () => ({ user: OWNER }) });
          }
          if (/\/enrollments$/.test(path)) {
            return Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'down' }) });
          }
          return Promise.resolve({ ok: true, json: async () => ({}) });
        }),
      );
      const res = await request(app).get(`/api/course/${courseId}`).set(asOwner());
      expect(res.status).toBe(403);
    });
  });
});
