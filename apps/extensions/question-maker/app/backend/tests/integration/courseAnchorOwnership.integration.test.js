/**
 * #1114 — trusted QM course-anchor ownership: POST /api/course RBAC,
 * teaching-enrollment gate, concurrency-safe ensure, and fail-closed access.
 * Requires TEST_DATABASE_URL — see docs/TEST_PLAN.md.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import { coursePage } from '../helpers/teachingInstructorFetch.js';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const { default: app } = await import('../../src/app.js');

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

const ADMIN = { id: 'cuid-anchor-admin', email: 'admin@test.com', role: 'ADMIN', name: 'Admin' };
const UNIT_ADMIN = {
  id: 'cuid-anchor-ua',
  email: 'ua@test.com',
  role: 'UNIT_ADMIN',
  name: 'Unit Admin',
};
const INSTRUCTOR = {
  id: 'cuid-anchor-inst',
  email: 'inst@test.com',
  role: 'INSTRUCTOR',
  name: 'Instructor',
};
const STUDENT = { id: 'cuid-anchor-stu', email: 'stu@test.com', role: 'STUDENT', name: 'Student' };
const TA = { id: 'cuid-anchor-ta', email: 'ta@test.com', role: 'TA', name: 'TA' };
const INSTRUCTOR_B = {
  id: 'cuid-anchor-inst-b',
  email: 'instb@test.com',
  role: 'INSTRUCTOR',
  name: 'Instructor B',
};

function cookieFor(label) {
  return { Cookie: `session=${label}` };
}

function userFromCookie(cookie = '') {
  if (cookie.includes('admin')) return ADMIN;
  if (cookie.includes('ua')) return UNIT_ADMIN;
  if (cookie.includes('inst-b')) return INSTRUCTOR_B;
  if (cookie.includes('inst')) return INSTRUCTOR;
  if (cookie.includes('stu')) return STUDENT;
  if (cookie.includes('ta')) return TA;
  return STUDENT;
}

/**
 * @param {{
 *   scopedIds?: string[],
 *   teachingByUserId?: Record<string, string[]>,
 *   enrollmentsFail?: boolean,
 * }} [opts]
 */
function makeFetch({ scopedIds = [], teachingByUserId = {}, enrollmentsFail = false } = {}) {
  return vi.fn().mockImplementation((url, opts) => {
    const target = String(url);
    const path = target.split('?')[0];
    const cookie = opts?.headers?.cookie ?? '';
    const user = userFromCookie(cookie);

    if (path.endsWith('/api/sessions/validate')) {
      return Promise.resolve({ ok: true, json: async () => ({ user }) });
    }

    if (/\/enrollments$/.test(path)) {
      if (enrollmentsFail) {
        return Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'down' }) });
      }
      // Service-key roster is unscoped — return every stubbed teaching enrollment
      // for this Core course (not the caller's cookie identity).
      const coreId = path.match(/\/api\/courses\/([^/]+)\/enrollments$/)?.[1];
      const enrollments = Object.entries(teachingByUserId).flatMap(([userId, taught]) =>
        taught.includes(coreId)
          ? [{ studentId: userId, role: 'INSTRUCTOR', isActive: true }]
          : [],
      );
      return Promise.resolve({ ok: true, json: async () => ({ enrollments }) });
    }

    if (path.endsWith('/api/courses')) {
      const idsParam = new URL(target).searchParams.get('ids');
      const ids = idsParam ? idsParam.split(',').filter(Boolean) : scopedIds;
      const rows = ids
        .filter((id) => scopedIds.includes(id))
        .map((id) => ({
          id,
          name: `Course ${id}`,
          code: 'C',
          callerEnrollmentRole: (teachingByUserId[user.id] ?? []).includes(id)
            ? 'INSTRUCTOR'
            : 'STUDENT',
        }));
      return Promise.resolve({ ok: true, json: async () => coursePage(rows) });
    }

    const detail = path.match(/\/api\/courses\/([^/]+)$/);
    if (detail) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ id: detail[1], name: `Course ${detail[1]}`, code: 'C' }),
      });
    }

    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

describeDb('course anchor ownership (#1114)', () => {
  let connectTestDatabase, truncateTestDatabase, prisma;

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    ({ connectTestDatabase, truncateTestDatabase, prisma } = testDb);
    await connectTestDatabase();
  });

  beforeEach(async () => {
    await truncateTestDatabase();
    for (const u of [ADMIN, UNIT_ADMIN, INSTRUCTOR, STUDENT, TA, INSTRUCTOR_B]) {
      await prisma.user.create({ data: { id: u.id, email: u.email, name: u.name } });
    }
  });

  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  describe('POST /api/course role gate', () => {
    it.each([
      ['STUDENT', 'stu'],
      ['TA', 'ta'],
    ])('rejects %s with 403', async (_role, label) => {
      vi.stubGlobal(
        'fetch',
        makeFetch({
          scopedIds: ['core-a'],
          teachingByUserId: { [STUDENT.id]: ['core-a'], [TA.id]: ['core-a'] },
        }),
      );
      const res = await request(app)
        .post('/api/course')
        .set(cookieFor(label))
        .send({ coreCourseId: 'core-a' });
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it.each([
      ['ADMIN', 'admin'],
      ['UNIT_ADMIN', 'ua'],
    ])('accepts %s without requiring a teaching enrollment', async (_role, label) => {
      vi.stubGlobal('fetch', makeFetch({ scopedIds: ['core-admin'] }));
      const res = await request(app)
        .post('/api/course')
        .set(cookieFor(label))
        .send({ coreCourseId: 'core-admin' });
      expect(res.status).toBe(201);
      expect(res.body.data.coreCourseId).toBe('core-admin');
    });

    it('accepts INSTRUCTOR who teaches the Core course', async () => {
      vi.stubGlobal(
        'fetch',
        makeFetch({
          scopedIds: ['core-taught'],
          teachingByUserId: { [INSTRUCTOR.id]: ['core-taught'] },
        }),
      );
      const res = await request(app)
        .post('/api/course')
        .set(cookieFor('inst'))
        .send({ coreCourseId: 'core-taught' });
      expect(res.status).toBe(201);
      expect(res.body.data.userId).toBe(INSTRUCTOR.id);
    });

    it('rejects INSTRUCTOR for a scoped course they only take as STUDENT', async () => {
      vi.stubGlobal(
        'fetch',
        makeFetch({
          scopedIds: ['core-student-only'],
          teachingByUserId: {}, // no teaching enrollment
        }),
      );
      const res = await request(app)
        .post('/api/course')
        .set(cookieFor('inst'))
        .send({ coreCourseId: 'core-student-only' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('CORE_COURSE_NOT_AUTHORIZED');
    });

    it('rejects INSTRUCTOR for a course not in their scoped list', async () => {
      vi.stubGlobal(
        'fetch',
        makeFetch({
          scopedIds: ['core-other'],
          teachingByUserId: { [INSTRUCTOR.id]: ['core-other'] },
        }),
      );
      const res = await request(app)
        .post('/api/course')
        .set(cookieFor('inst'))
        .send({ coreCourseId: 'core-missing' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('CORE_COURSE_NOT_AUTHORIZED');
    });
  });

  describe('POST /api/course concurrency', () => {
    it('returns the same persisted owner for concurrent ensures', async () => {
      const coreCourseId = 'core-race';
      vi.stubGlobal(
        'fetch',
        makeFetch({
          scopedIds: [coreCourseId],
          teachingByUserId: {
            [INSTRUCTOR.id]: [coreCourseId],
            [INSTRUCTOR_B.id]: [coreCourseId],
          },
        }),
      );

      const [a, b] = await Promise.all([
        request(app).post('/api/course').set(cookieFor('inst')).send({ coreCourseId }),
        request(app).post('/api/course').set(cookieFor('inst-b')).send({ coreCourseId }),
      ]);

      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(a.body.data.id).toBe(b.body.data.id);
      expect(a.body.data.userId).toBe(b.body.data.userId);

      const row = await prisma.course.findUnique({ where: { coreCourseId } });
      expect(row).toBeTruthy();
      expect(row.userId).toBe(a.body.data.userId);
      expect(await prisma.course.count({ where: { coreCourseId } })).toBe(1);
    });

    it('stays idempotent when POST races auto-import for the same coreCourseId', async () => {
      const coreCourseId = 'core-race-import';
      vi.stubGlobal(
        'fetch',
        makeFetch({
          scopedIds: [coreCourseId],
          teachingByUserId: { [INSTRUCTOR.id]: [coreCourseId] },
        }),
      );

      const { importTaughtCoursesFromCore } = await import(
        '../../src/services/importTaughtCoursesService.js'
      );

      const [postRes, importResult] = await Promise.all([
        request(app).post('/api/course').set(cookieFor('inst')).send({ coreCourseId }),
        importTaughtCoursesFromCore(INSTRUCTOR.id, 'INSTRUCTOR', 'session=inst'),
      ]);

      expect([200, 201]).toContain(postRes.status);
      expect(postRes.body.success).toBe(true);
      expect(await prisma.course.count({ where: { coreCourseId } })).toBe(1);
      expect((importResult.imported ?? 0) + (postRes.status === 201 ? 1 : 0)).toBeGreaterThanOrEqual(1);
      expect(postRes.body.data.id).toBe(
        (await prisma.course.findUnique({ where: { coreCourseId } })).id,
      );
    });

    it('stays idempotent when POST races ADMIN catalog materialization', async () => {
      const coreCourseId = 'core-race-admin';
      vi.stubGlobal(
        'fetch',
        makeFetch({
          scopedIds: [coreCourseId],
          teachingByUserId: { [INSTRUCTOR.id]: [coreCourseId] },
        }),
      );

      // ADMIN list materialization now calls ensureCourseAnchor per missing id
      // (#1074 / #1270) — race that path directly against POST.
      const { ensureCourseAnchor } = await import('../../src/services/ensureCourseAnchor.js');

      const [postRes] = await Promise.all([
        request(app).post('/api/course').set(cookieFor('inst')).send({ coreCourseId }),
        ensureCourseAnchor(ADMIN.id, coreCourseId),
      ]);

      expect([200, 201]).toContain(postRes.status);
      expect(postRes.body.success).toBe(true);
      expect(await prisma.course.count({ where: { coreCourseId } })).toBe(1);
      expect(postRes.body.data.id).toBe(
        (await prisma.course.findUnique({ where: { coreCourseId } })).id,
      );
    });

    it('recovers when an unlocked writer inserts between lookup and create (P2002 outside txn)', async () => {
      // Deterministic stand-in for a legacy unlocked createMany/bare-create path:
      // after the locked transaction sees no row, an unlocked insert wins the
      // unique index. Recovery must reread outside the aborted txn (#1270).
      const coreCourseId = 'core-race-unlocked';
      const { ensureCourseAnchor } = await import('../../src/services/ensureCourseAnchor.js');
      const { prisma: db } = await import('../../src/config/database.js');

      const originalTransaction = db.$transaction.bind(db);
      let injected = false;
      db.$transaction = async (fn) =>
        originalTransaction(async (tx) => {
          const wrapped = {
            $executeRaw: (...args) => tx.$executeRaw(...args),
            course: {
              findUnique: async (...args) => {
                const existing = await tx.course.findUnique(...args);
                if (!existing && !injected) {
                  injected = true;
                  await db.course.create({
                    data: { userId: ADMIN.id, coreCourseId },
                  });
                }
                return existing;
              },
              create: (...args) => tx.course.create(...args),
            },
          };
          return fn(wrapped);
        });

      try {
        const result = await ensureCourseAnchor(INSTRUCTOR.id, coreCourseId);
        expect(result.created).toBe(false);
        expect(result.course.userId).toBe(ADMIN.id);
        expect(await prisma.course.count({ where: { coreCourseId } })).toBe(1);
      } finally {
        db.$transaction = originalTransaction;
      }
    });
  });
});
