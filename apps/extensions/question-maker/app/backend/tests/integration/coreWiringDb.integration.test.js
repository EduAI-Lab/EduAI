/**
 * DB-backed integration tests for QM → Core wiring routes.
 *
 * Requires TEST_DATABASE_URL to be set (see .env). All auth is handled by
 * stubbing global fetch to return a fixed Core user for session validation.
 * Outbound Core API calls (topics, questions) are also stubbed via fetch.
 * Test data is seeded directly through Prisma — no register/login endpoint.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createId } from '@paralleldrive/cuid2';

// findOrCreateUser is called by requireAuth after session validate succeeds.
// Mock it so we don't need a running Core for user row upserts.
vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const { default: app } = await import('../../src/app.js');

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

// The user seeded in beforeEach — matches what fetch mock returns.
const TEST_USER = { id: 'cuid-test-user', email: 'test@test.com', role: 'INSTRUCTOR', name: 'Test Instructor' };

// Returns a fetch stub that:
//  - answers session/validate with TEST_USER
//  - answers any further calls with the provided mocks in order
function makeFetch(...extraMocks) {
  const sessionReply = { ok: true, json: () => Promise.resolve({ user: TEST_USER }) };
  return vi.fn()
    .mockResolvedValueOnce(sessionReply)
    .mockImplementation(() => {
      const next = extraMocks.shift();
      return next
        ? Promise.resolve(next)
        : Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
}

/** #1041: Core's course list answers with `{ data, total, page, pageSize }`. */
function coursePage(rows) {
  return { data: rows, total: rows.length, page: 1, pageSize: 100 };
}

function coreOk(data, status = 200) {
  return { ok: true, status, json: () => Promise.resolve(data) };
}
function coreErr(data, status) {
  return { ok: false, status, json: () => Promise.resolve(data) };
}

// Per-course access gate (requireCourseAccess) resolves a LINKED course's access
// from Core enrollment, so any route on a linked course makes one enrollment
// fetch before the handler runs. This reply lists TEST_USER as an active
// instructor so the gate grants access.
function enrollmentOk() {
  return coreOk({ enrollments: [{ studentId: TEST_USER.id, role: 'INSTRUCTOR', isActive: true }] });
}

describeDb('Core wiring DB integration', () => {
  let connectTestDatabase, truncateTestDatabase, prisma;
  let courseId, topicId, questionId, variantId;

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    connectTestDatabase = testDb.connectTestDatabase;
    truncateTestDatabase = testDb.truncateTestDatabase;
    prisma = testDb.prisma;
    await connectTestDatabase();
  });

  beforeEach(async () => {
    await truncateTestDatabase();

    // Seed user (mirrors what requireAuth puts in req.user)
    await prisma.user.create({ data: { id: TEST_USER.id, email: TEST_USER.email, name: TEST_USER.name } });

    // Seed a course (not yet linked to Core)
    const course = await prisma.course.create({ data: { userId: TEST_USER.id } });
    courseId = course.id;

    // Seed a topic
    const topic = await prisma.topics.create({ data: { id: createId(), courseId, name: 'Chapter 1' } });
    topicId = topic.id;

    // Seed a question + draft variant
    const q = await prisma.questionMetadata.create({ data: { courseId, primaryTopicId: topicId, type: 'SA' } });
    questionId = q.id;

    const v = await prisma.variants.create({
      data: {
        questionMetadataId: questionId,
        questionText: 'What is sorting?',
        isDraft: true,
      },
    });
    variantId = v.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  const cookie = () => ({ Cookie: 'session=valid' });

  // ---------------------------------------------------------------------------
  // PATCH /api/course/:id/link-core
  // ---------------------------------------------------------------------------
  describe('PATCH /api/course/:id/link-core', () => {
    it('stores coreCourseId on the course', async () => {
      vi.stubGlobal(
        'fetch',
        makeFetch(coreOk(coursePage([{ id: 'cuid-core-course', code: 'COSC 111' }]))),
      );

      const res = await request(app)
        .patch(`/api/course/${courseId}/link-core`)
        .set(cookie())
        .send({ coreCourseId: 'cuid-core-course' });

      expect(res.status).toBe(200);
      expect(res.body.data.coreCourseId).toBe('cuid-core-course');

      const updated = await prisma.course.findUnique({ where: { id: courseId } });
      expect(updated.coreCourseId).toBe('cuid-core-course');
    });

    it('returns 403 when coreCourseId is outside the instructor scoped Core list (#578)', async () => {
      vi.stubGlobal(
        'fetch',
        makeFetch(coreOk(coursePage([{ id: 'cuid-other', code: 'MATH 101' }]))),
      );

      const res = await request(app)
        .patch(`/api/course/${courseId}/link-core`)
        .set(cookie())
        .send({ coreCourseId: 'cuid-core-course' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('CORE_COURSE_NOT_AUTHORIZED');

      const unchanged = await prisma.course.findUnique({ where: { id: courseId } });
      expect(unchanged.coreCourseId).toBeNull();
    });

    it('returns 404 for a course the user does not own', async () => {
      vi.stubGlobal(
        'fetch',
        makeFetch(coreOk(coursePage([{ id: 'cuid-core-course', code: 'COSC 111' }]))),
      );

      const res = await request(app)
        .patch('/api/course/99999/link-core')
        .set(cookie())
        .send({ coreCourseId: 'cuid-core-course' });

      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/course/:id/sync-topics
  // ---------------------------------------------------------------------------
  describe('POST /api/course/:id/sync-topics', () => {
    it('returns 400 when course is not linked to Core', async () => {
      vi.stubGlobal('fetch', makeFetch());

      const res = await request(app)
        .post(`/api/course/${courseId}/sync-topics`)
        .set(cookie());

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not linked/i);
    });

    it('upserts new Core topics and links existing ones by name', async () => {
      await prisma.course.update({ where: { id: courseId }, data: { coreCourseId: 'cuid-core-course' } });

      const coreTopics = [
        { id: 'cuid-t1', name: 'Chapter 1' }, // matches existing local topic by name
        { id: 'cuid-t2', name: 'Chapter 2' }, // new
      ];
      vi.stubGlobal('fetch', makeFetch(enrollmentOk(), coreOk({ topics: coreTopics })));

      const res = await request(app)
        .post(`/api/course/${courseId}/sync-topics`)
        .set(cookie());

      expect(res.status).toBe(200);
      expect(res.body.data.synced).toBe(2);

      const ch1 = await prisma.topics.findFirst({ where: { courseId, name: 'Chapter 1' } });
      expect(ch1.coreTopicId).toBe('cuid-t1');

      const ch2 = await prisma.topics.findFirst({ where: { courseId, name: 'Chapter 2' } });
      expect(ch2.coreTopicId).toBe('cuid-t2');
    });

    it('returns 502 when Core fetch fails', async () => {
      await prisma.course.update({ where: { id: courseId }, data: { coreCourseId: 'cuid-core-course' } });

      vi.stubGlobal('fetch', makeFetch(enrollmentOk(), coreErr({ error: 'Service Unavailable' }, 503)));

      const res = await request(app)
        .post(`/api/course/${courseId}/sync-topics`)
        .set(cookie());

      expect(res.status).toBe(502);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/course/:id/topics — Core push on creation
  // ---------------------------------------------------------------------------
  describe('POST /api/course/:id/topics — Core push', () => {
    it('pushes to Core and stores coreTopicId when course is linked', async () => {
      await prisma.course.update({ where: { id: courseId }, data: { coreCourseId: 'cuid-core-course' } });

      // fetch: session validate, enrollment access check, then Core POST /topics
      vi.stubGlobal('fetch', makeFetch(enrollmentOk(), coreOk({ id: 'cuid-new-topic', name: 'Sorting' }, 201)));

      const res = await request(app)
        .post(`/api/course/${courseId}/topics`)
        .set(cookie())
        .send({ name: 'Sorting' });

      expect(res.status).toBe(201);
      expect(res.body.data.coreTopicId).toBe('cuid-new-topic');

      const stored = await prisma.topics.findFirst({ where: { courseId, name: 'Sorting' } });
      expect(stored.coreTopicId).toBe('cuid-new-topic');
    });

    it('creates topic locally even when Core push fails', async () => {
      await prisma.course.update({ where: { id: courseId }, data: { coreCourseId: 'cuid-core-course' } });

      vi.stubGlobal('fetch', makeFetch(enrollmentOk(), { ok: false, status: 503, json: () => Promise.resolve({}) }));

      const res = await request(app)
        .post(`/api/course/${courseId}/topics`)
        .set(cookie())
        .send({ name: 'Fallback Topic' });

      expect(res.status).toBe(201);
      expect(res.body.data.coreTopicId).toBeNull();

      const stored = await prisma.topics.findFirst({ where: { courseId, name: 'Fallback Topic' } });
      expect(stored).not.toBeNull();
      expect(stored.coreTopicId).toBeNull();
    });

    it('uses existingId when Core returns 409', async () => {
      await prisma.course.update({ where: { id: courseId }, data: { coreCourseId: 'cuid-core-course' } });

      vi.stubGlobal(
        'fetch',
        makeFetch(enrollmentOk(), {
          ok: false,
          status: 409,
          json: () => Promise.resolve({ error: 'TOPIC_ALREADY_EXISTS', existingId: 'cuid-existing-topic' }),
        }),
      );

      // Use a name that doesn't already exist locally so Topics.create succeeds
      const res = await request(app)
        .post(`/api/course/${courseId}/topics`)
        .set(cookie())
        .send({ name: 'Sorting Algorithms' });

      expect(res.status).toBe(201);
      expect(res.body.data.coreTopicId).toBe('cuid-existing-topic');
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/questions/variants/:variantId/testable
  // ---------------------------------------------------------------------------
  describe('PATCH /api/questions/variants/:variantId/testable', () => {
    it('returns 404 for a non-existent variant (access check precedes payload validation)', async () => {
      vi.stubGlobal('fetch', makeFetch());

      const res = await request(app)
        .patch('/api/questions/variants/999999/testable')
        .set(cookie())
        .send({ testable: 'yes' });

      expect(res.status).toBe(404);
    });

    it('returns 400 when variant has no coreQuestionId', async () => {
      vi.stubGlobal('fetch', makeFetch());

      const res = await request(app)
        .patch(`/api/questions/variants/${variantId}/testable`)
        .set(cookie())
        .send({ testable: true });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Core/i);
    });

    it('nulls coreQuestionId and returns 404 on Core QUESTION_NOT_FOUND', async () => {
      await prisma.variants.update({ where: { id: variantId }, data: { coreQuestionId: 'cuid-core-q' } });

      vi.stubGlobal('fetch', makeFetch(coreErr({ error: 'QUESTION_NOT_FOUND' }, 404)));

      const res = await request(app)
        .patch(`/api/questions/variants/${variantId}/testable`)
        .set(cookie())
        .send({ testable: true });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('QUESTION_NOT_FOUND');

      const updated = await prisma.variants.findUnique({ where: { id: variantId } });
      expect(updated.coreQuestionId).toBeNull();
    });

    it('returns { id, testable } on Core success', async () => {
      await prisma.variants.update({ where: { id: variantId }, data: { coreQuestionId: 'cuid-core-q' } });

      vi.stubGlobal('fetch', makeFetch(coreOk({ id: 'cuid-core-q', testable: true })));

      const res = await request(app)
        .patch(`/api/questions/variants/${variantId}/testable`)
        .set(cookie())
        .send({ testable: true });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ id: 'cuid-core-q', testable: true });
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/course — ADMIN catalog materialization (#1074)
  // ---------------------------------------------------------------------------
  describe('GET /api/course — ADMIN catalog materialization', () => {
    const ADMIN_USER = { id: 'cuid-admin-user', email: 'admin@test.com', role: 'ADMIN', name: 'Admin' };
    const adminCookie = () => ({ Cookie: 'session=admin' });

    // ADMIN materialization inserts a Course row owned by the admin — `userId`
    // has a real FK to `users` — the admin row must exist locally even though
    // findOrCreateUser is mocked.
    beforeEach(async () => {
      await prisma.user.create({ data: { id: ADMIN_USER.id, email: ADMIN_USER.email, name: ADMIN_USER.name } });
    });

    function makeAdminFetch(...extraMocks) {
      const sessionReply = { ok: true, json: () => Promise.resolve({ user: ADMIN_USER }) };
      return vi.fn()
        .mockResolvedValueOnce(sessionReply)
        .mockImplementation(() => {
          const next = extraMocks.shift();
          return next
            ? Promise.resolve(next)
            : Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });
    }

    it('materializes a local anchor for a Core course no one has ever linked, and links by real local id', async () => {
      // Core's catalog has one course (`cuid-core-only`) that has no local
      // anchor at all — this is the #1074 gap: previously ADMIN's list only
      // ever showed the pre-existing `courseId` row, never the Core-only one.
      vi.stubGlobal(
        'fetch',
        makeAdminFetch(
          coreOk(
            coursePage([
              { id: 'cuid-core-course', name: 'Existing Course', code: 'COSC 111' },
              { id: 'cuid-core-only', name: 'Core Only Course', code: 'MATH 200' },
            ]),
          ),
        ),
      );
      await prisma.course.update({ where: { id: courseId }, data: { coreCourseId: 'cuid-core-course' } });

      const res = await request(app).get('/api/course?page=1&pageSize=100').set(adminCookie());

      expect(res.status).toBe(200);
      const names = res.body.data.map((c) => c.name).sort();
      expect(names).toEqual(['Core Only Course', 'Existing Course']);

      // The materialized row is a real, queryable local anchor — not a
      // synthesized response-only object — owned by the requesting admin.
      const materialized = await prisma.course.findFirst({ where: { coreCourseId: 'cuid-core-only' } });
      expect(materialized).not.toBeNull();
      expect(materialized.userId).toBe(ADMIN_USER.id);

      const returnedRow = res.body.data.find((c) => c.coreCourseId === 'cuid-core-only');
      expect(returnedRow.id).toBe(materialized.id);
    });

    it('is idempotent: a second request creates no duplicate anchor', async () => {
      vi.stubGlobal(
        'fetch',
        makeAdminFetch(coreOk(coursePage([{ id: 'cuid-core-only', name: 'Core Only Course' }]))),
      );

      const first = await request(app).get('/api/course?page=1&pageSize=100').set(adminCookie());
      expect(first.status).toBe(200);
      const firstRow = first.body.data.find((c) => c.coreCourseId === 'cuid-core-only');
      expect(firstRow).toBeTruthy();

      vi.stubGlobal(
        'fetch',
        makeAdminFetch(coreOk(coursePage([{ id: 'cuid-core-only', name: 'Core Only Course' }]))),
      );

      const second = await request(app).get('/api/course?page=1&pageSize=100').set(adminCookie());
      expect(second.status).toBe(200);
      const secondRow = second.body.data.find((c) => c.coreCourseId === 'cuid-core-only');
      expect(secondRow.id).toBe(firstRow.id);

      const all = await prisma.course.findMany({ where: { coreCourseId: 'cuid-core-only' } });
      expect(all).toHaveLength(1);
    });

    it('does not materialize and does not error when Core is unreachable', async () => {
      await prisma.course.update({ where: { id: courseId }, data: { coreCourseId: 'cuid-core-course' } });
      vi.stubGlobal(
        'fetch',
        makeAdminFetch(coreErr({ error: 'Service Unavailable' }, 503)),
      );

      const res = await request(app).get('/api/course?page=1&pageSize=100').set(adminCookie());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].coreUnavailable).toBe(true);

      const total = await prisma.course.count();
      expect(total).toBe(1); // no new anchor materialized
    });
  });
});
