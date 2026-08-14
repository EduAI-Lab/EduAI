/**
 * DB-backed coverage tests for course.js (issue #1217: course.js was the
 * second-largest uncovered file). Existing suites (courseRbac, coreWiringDb,
 * syncTopicsCounter, courseAuth) cover the per-course access gate, link-core
 * happy paths, and Core topic-push variants; this file targets the remaining
 * gaps: POST / (creation, idempotent re-link, the unique-constraint race
 * recovery, and the not-authorized/Core-error branches), GET / with
 * includeStats, GET /:id/enrollments, GET /:id?includeDetails, DELETE /:id,
 * and PATCH /:id/link-core's Core-error branch.
 *
 * Real test DB (see tests/helpers/testDb.js); Core calls are routed by URL
 * pattern through a single fetch stub instead of a strict call-order queue,
 * since these routes make a variable number of Core calls depending on branch.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import request from 'supertest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const { default: app } = await import('../../src/app.js');

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

const USER = { id: 'cuid-cov-user', email: 'cov@test.com', role: 'INSTRUCTOR', name: 'Cov User' };
// ADMIN short-circuits resolveAccessForCourse before the coreCourseId check
// (#1114), so it is the only caller that can reach an unlinked course's
// routes below — used by the fixtures that intentionally leave coreCourseId
// unset to exercise the "not linked to Core" branches.
const ADMIN = { id: 'cuid-cov-admin', email: 'cov-admin@test.com', role: 'ADMIN', name: 'Cov Admin' };
const cookie = () => ({ Cookie: 'session=valid' });

function jsonRes(data, { ok = true, status = ok ? 200 : 500 } = {}) {
  return { ok, status, json: () => Promise.resolve(data) };
}

/**
 * Routes fetch calls by URL substring. Session validate always answers with
 * `user` (defaults to USER); everything else falls through `handlers` in
 * order (first match wins, `reply` may be a value or a () => value thunk for
 * call-order-sensitive responses). Unmatched `/enrollments` calls default to
 * an active INSTRUCTOR enrollment for the caller (#1114 teaching-enrollment /
 * per-course access gate) so pre-#1114 fixtures don't need to opt in
 * individually; everything else defaults to an empty-ok response.
 */
function routedFetch(handlers = [], { user = USER } = {}) {
  return vi.fn().mockImplementation((url) => {
    const u = String(url);
    if (u.includes('/api/sessions/validate')) {
      return Promise.resolve(jsonRes({ user }));
    }
    for (const { test, reply } of handlers) {
      if (test(u)) return Promise.resolve(typeof reply === 'function' ? reply() : reply);
    }
    if (u.includes('/enrollments')) {
      return Promise.resolve(
        jsonRes({ enrollments: [{ studentId: user.id, isActive: true, role: 'INSTRUCTOR' }] }),
      );
    }
    return Promise.resolve(jsonRes({}));
  });
}

describeDb('course.js route coverage (integration)', () => {
  let connectTestDatabase, truncateTestDatabase, prisma;

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    ({ connectTestDatabase, truncateTestDatabase, prisma } = testDb);
    await connectTestDatabase();
  });

  beforeEach(async () => {
    await truncateTestDatabase();
    await prisma.user.create({ data: { id: USER.id, email: USER.email, name: USER.name } });
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  describe('POST /api/course', () => {
    it('creates a new course anchor when the Core course is in the caller scoped list', async () => {
      vi.stubGlobal(
        'fetch',
        routedFetch([
          { test: (u) => u.includes('/api/courses') && !u.includes('/enrollments'), reply: jsonRes({ data: [{ id: 'core-new' }], total: 1, page: 1, pageSize: 100 }) },
        ]),
      );

      const res = await request(app).post('/api/course').set(cookie()).send({ coreCourseId: 'core-new' });

      expect(res.status).toBe(201);
      expect(res.body.data.coreCourseId).toBe('core-new');

      const stored = await prisma.course.findUnique({ where: { coreCourseId: 'core-new' } });
      expect(stored.userId).toBe(USER.id);
    });

    it('requires coreCourseId', async () => {
      vi.stubGlobal('fetch', routedFetch());
      const res = await request(app).post('/api/course').set(cookie()).send({});
      expect(res.status).toBe(400);
    });

    it('returns 403 when the Core course is not in the caller scoped list', async () => {
      vi.stubGlobal(
        'fetch',
        routedFetch([
          { test: (u) => u.includes('/api/courses'), reply: jsonRes({ data: [], total: 0, page: 1, pageSize: 100 }) },
        ]),
      );

      const res = await request(app).post('/api/course').set(cookie()).send({ coreCourseId: 'core-outside' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('CORE_COURSE_NOT_AUTHORIZED');
    });

    it('returns the Core error status when the scoped-list lookup fails', async () => {
      vi.stubGlobal(
        'fetch',
        routedFetch([{ test: (u) => u.includes('/api/courses'), reply: jsonRes({ error: 'boom' }, { ok: false, status: 502 }) }]),
      );

      const res = await request(app).post('/api/course').set(cookie()).send({ coreCourseId: 'core-x' });

      expect(res.status).toBe(502);
    });

    it('is idempotent: re-linking an already-anchored coreCourseId returns 200 with the existing row', async () => {
      const existing = await prisma.course.create({ data: { userId: USER.id, coreCourseId: 'core-existing' } });
      vi.stubGlobal(
        'fetch',
        routedFetch([
          { test: (u) => u.includes('/api/courses') && !u.includes('/enrollments'), reply: jsonRes({ data: [{ id: 'core-existing' }], total: 1, page: 1, pageSize: 100 }) },
        ]),
      );

      const res = await request(app).post('/api/course').set(cookie()).send({ coreCourseId: 'core-existing' });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/already linked/i);
      expect(res.body.data.id).toBe(existing.id);
    });

    it('recovers from a create-time unique-constraint race by re-reading the winning row', async () => {
      // Force the race deterministically: let ensureCourseAnchor's own
      // findUnique() miss (no row yet), then insert the competing row from a
      // second, unmocked prisma call before its create() runs — its real
      // unique constraint on coreCourseId then rejects with P2002, and the
      // route must recover by re-reading the row the "other" insert won, not
      // 500. ensureCourseAnchor's lookups run on the transaction client
      // (`tx`), a distinct object from `prisma.course` (#1114 advisory-lock
      // refactor), so the interception has to hook the `tx` handed to the
      // first `$transaction` call rather than `prisma.course` directly.
      await prisma.user.create({ data: { id: 'someone-else', email: 'other@test.com', name: 'Other' } });
      const realTransaction = prisma.$transaction.bind(prisma);
      const spy = vi.spyOn(prisma, '$transaction').mockImplementationOnce((fn) =>
        realTransaction(async (tx) => {
          const realTxFindUnique = tx.course.findUnique.bind(tx.course);
          vi.spyOn(tx.course, 'findUnique').mockImplementationOnce(async (...args) => {
            const result = await realTxFindUnique(...args);
            await prisma.course.create({ data: { userId: 'someone-else', coreCourseId: 'core-race' } });
            return result;
          });
          return fn(tx);
        }),
      );
      vi.stubGlobal(
        'fetch',
        routedFetch([
          { test: (u) => u.includes('/api/courses') && !u.includes('/enrollments'), reply: jsonRes({ data: [{ id: 'core-race' }], total: 1, page: 1, pageSize: 100 }) },
        ]),
      );

      const res = await request(app).post('/api/course').set(cookie()).send({ coreCourseId: 'core-race' });

      expect(res.status).toBe(200);
      expect(res.body.data.coreCourseId).toBe('core-race');
      expect(res.body.data.userId).toBe('someone-else');
      spy.mockRestore();

      const all = await prisma.course.findMany({ where: { coreCourseId: 'core-race' } });
      expect(all).toHaveLength(1);
    });
  });

  describe('GET /api/course?includeStats=true', () => {
    it('includes per-course question/topic stats for the visible page', async () => {
      const course = await prisma.course.create({ data: { userId: USER.id } });
      const topic = await prisma.topics.create({ data: { id: 'topic-1', courseId: course.id, name: 'T1' } });
      await prisma.questionMetadata.create({
        data: { courseId: course.id, primaryTopicId: topic.id, type: 'MCQ' },
      });
      vi.stubGlobal('fetch', routedFetch());

      const res = await request(app)
        .get('/api/course?page=1&pageSize=10&includeStats=true')
        .set(cookie());

      expect(res.status).toBe(200);
      const row = res.body.data.find((c) => c.id === course.id);
      expect(row.stats).toMatchObject({ totalQuestions: 1, totalTopics: 1, questionTypes: { MCQ: 1 } });
    });
  });

  describe('GET /api/course/:id/enrollments', () => {
    it('returns an empty list when the course is not linked to Core', async () => {
      // Unlinked courses are only reachable by ADMIN (#1114 fail-closed access) —
      // ADMIN short-circuits resolveAccessForCourse before the coreCourseId check.
      const course = await prisma.course.create({ data: { userId: USER.id } });
      vi.stubGlobal('fetch', routedFetch([], { user: ADMIN }));

      const res = await request(app).get(`/api/course/${course.id}/enrollments`).set(cookie());

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('returns only active enrollments, mapped to the QM shape', async () => {
      const course = await prisma.course.create({ data: { userId: USER.id, coreCourseId: 'core-enr' } });
      // requireCourseAccess's gate and the route's own roster fetch both hit
      // /enrollments; the first call must show the caller as actively
      // teaching (#1114) to pass the gate, the second is the roster this
      // test actually asserts on.
      let enrollmentCalls = 0;
      vi.stubGlobal(
        'fetch',
        routedFetch([
          {
            test: (u) => u.includes('/enrollments'),
            reply: () => {
              enrollmentCalls += 1;
              if (enrollmentCalls === 1) {
                return jsonRes({ enrollments: [{ studentId: USER.id, isActive: true, role: 'INSTRUCTOR' }] });
              }
              return jsonRes({
                enrollments: [
                  { studentId: 's1', studentName: 'Alice', studentEmail: 'a@t.co', role: 'STUDENT', isActive: true },
                  { studentId: 's2', studentName: 'Bob', studentEmail: 'b@t.co', role: 'STUDENT', isActive: false },
                ],
              });
            },
          },
        ]),
      );

      const res = await request(app).get(`/api/course/${course.id}/enrollments`).set(cookie());

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ userId: 's1', name: 'Alice', email: 'a@t.co', role: 'STUDENT' }]);
    });
  });

  describe('GET /api/course/:id?includeDetails=true', () => {
    it('returns question/topic detail for the course', async () => {
      const course = await prisma.course.create({ data: { userId: USER.id } });
      const topic = await prisma.topics.create({ data: { id: 'topic-2', courseId: course.id, name: 'T2' } });
      await prisma.questionMetadata.create({
        data: { courseId: course.id, primaryTopicId: topic.id, type: 'SA', description: 'desc' },
      });
      // Unlinked course: ADMIN is the only caller that can reach it (#1114).
      vi.stubGlobal('fetch', routedFetch([], { user: ADMIN }));

      const res = await request(app).get(`/api/course/${course.id}?includeDetails=true`).set(cookie());

      expect(res.status).toBe(200);
      expect(res.body.data.topics).toHaveLength(1);
      expect(res.body.data.questionMetadata).toHaveLength(1);
    });
  });

  describe('DELETE /api/course/:id', () => {
    it('deletes the course', async () => {
      // Unlinked course: ADMIN is the only caller that can reach it (#1114).
      const course = await prisma.course.create({ data: { userId: USER.id } });
      vi.stubGlobal('fetch', routedFetch([], { user: ADMIN }));

      const res = await request(app).delete(`/api/course/${course.id}`).set(cookie());

      expect(res.status).toBe(200);
      const reloaded = await prisma.course.findUnique({ where: { id: course.id } });
      expect(reloaded).toBeNull();
    });
  });

  describe('PATCH /api/course/:id/link-core', () => {
    it('returns the Core error status when the scoped-list lookup fails', async () => {
      // Unlinked course: ADMIN is the only caller that can reach it (#1114).
      const course = await prisma.course.create({ data: { userId: USER.id } });
      vi.stubGlobal(
        'fetch',
        routedFetch(
          [{ test: (u) => u.includes('/api/courses') && !u.includes('/enrollments'), reply: jsonRes({ error: 'down' }, { ok: false, status: 503 }) }],
          { user: ADMIN },
        ),
      );

      const res = await request(app)
        .patch(`/api/course/${course.id}/link-core`)
        .set(cookie())
        .send({ coreCourseId: 'core-y' });

      expect(res.status).toBe(503);
    });

    it('requires coreCourseId', async () => {
      // Unlinked course: ADMIN is the only caller that can reach it (#1114).
      const course = await prisma.course.create({ data: { userId: USER.id } });
      vi.stubGlobal('fetch', routedFetch([], { user: ADMIN }));

      const res = await request(app).patch(`/api/course/${course.id}/link-core`).set(cookie()).send({});

      expect(res.status).toBe(400);
    });
  });
});
