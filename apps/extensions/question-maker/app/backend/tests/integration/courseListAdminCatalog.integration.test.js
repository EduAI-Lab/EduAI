/**
 * DB-backed regression coverage for the #1410 review's top-priority item:
 * ADMIN's `GET /api/course` must never let a second, separately-failable Core
 * catalog request clobber names the first (already-successful) catalog fetch
 * resolved (`courseListService.listCoursesPageForUser`).
 *
 * Before the fix, the ADMIN branch fetched Core's full catalog once inside
 * `listCoursesForUser` (materialization pass) and then issued a SEPARATE
 * `getCoursesByIdsFromCore` call to project names onto the current page. If
 * that second call failed, every course's name degraded to the "Course
 * unavailable" placeholder even though the first call had already resolved
 * the real names. The fix reuses the cached catalog from the first call
 * instead of re-fetching.
 *
 * This suite also exercises the `COURSE_ACCESS_SYNC_TTL_MS`-driven catalog
 * cache's test-only reset (`resetCourseAccessSyncForTests`) to prove state
 * does not leak between test cases — the reviewer's second ask on this item.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import request from 'supertest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const { default: app } = await import('../../src/app.js');
const { resetCourseAccessSyncForTests } = await import('../../src/services/courseListService.js');
const { resetCoreImportThrottleForTests } = await import('../../src/routes/course.js');

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

const ADMIN = { id: 'cuid-catalog-admin', email: 'catalog-admin@test.com', role: 'ADMIN', name: 'Catalog Admin' };
const cookie = () => ({ Cookie: 'session=admin' });

function jsonRes(data, { ok = true, status = ok ? 200 : 500 } = {}) {
  return { ok, status, json: () => Promise.resolve(data) };
}

/**
 * Session validate always answers with ADMIN. Every OTHER call is routed to
 * `catalogReply` in sequence: the 1st non-session call is the full-catalog
 * fetch inside `listCoursesForUser`'s materialization pass, the 2nd (if the
 * fixed code still made one — it should not for ADMIN) would be the
 * since-removed second catalog request. Any call beyond what a test expects
 * falls back to an empty-ok response so an unanticipated Core.js background
 * mirror call never crashes the request.
 */
function makeAdminFetch(catalogReplies) {
  let call = 0;
  return vi.fn().mockImplementation((url) => {
    const u = String(url);
    if (u.includes('/api/sessions/validate')) {
      return Promise.resolve(jsonRes({ user: ADMIN }));
    }
    if (u.includes('/api/courses')) {
      const reply = catalogReplies[call];
      call += 1;
      return Promise.resolve(reply ?? jsonRes({ data: [], total: 0, page: 1, pageSize: 200 }));
    }
    return Promise.resolve(jsonRes({}));
  });
}

describeDb('ADMIN course catalog reuse (integration, #1410 review item 3)', () => {
  let connectTestDatabase, truncateTestDatabase, prisma;

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    ({ connectTestDatabase, truncateTestDatabase, prisma } = testDb);
    await connectTestDatabase();
  });

  beforeEach(async () => {
    await truncateTestDatabase();
    await prisma.user.create({ data: { id: ADMIN.id, email: ADMIN.email, name: ADMIN.name } });
    // Reset the TTL-cached catalog and access-mirror state so no test can see
    // another test's cached Core response (the reviewer's explicit ask).
    resetCourseAccessSyncForTests();
    resetCoreImportThrottleForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetCourseAccessSyncForTests();
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('admin case 1: resolves real Core names for a fresh anchor from the single catalog fetch', async () => {
    vi.stubGlobal(
      'fetch',
      makeAdminFetch([
        jsonRes({
          data: [{ id: 'core-1', name: 'Intro to Testing', code: 'TEST101', department: 'COSC' }],
          total: 1,
          page: 1,
          pageSize: 200,
        }),
      ]),
    );

    const res = await request(app).get('/api/course?page=1&pageSize=25').set(cookie());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Intro to Testing');
    expect(res.body.data[0].code).toBe('TEST101');
    expect(res.body.data[0].coreUnavailable).toBe(false);

    vi.unstubAllGlobals();
  });

  it('admin case 2: a later Core outage does not overwrite names already resolved by the earlier successful catalog fetch', async () => {
    // First request: Core is up, the catalog resolves and materializes an
    // anchor with a real name — this also warms the TTL cache.
    vi.stubGlobal(
      'fetch',
      makeAdminFetch([
        jsonRes({
          data: [{ id: 'core-2', name: 'Advanced Algorithms', code: 'COSC404', department: 'COSC' }],
          total: 1,
          page: 1,
          pageSize: 200,
        }),
      ]),
    );

    const first = await request(app).get('/api/course?page=1&pageSize=25').set(cookie());
    expect(first.status).toBe(200);
    expect(first.body.data[0].name).toBe('Advanced Algorithms');
    vi.unstubAllGlobals();

    // Second request within the same TTL window: even if a naive
    // implementation issued a second Core request here and it failed, the
    // fix must serve the name from the already-warm cache, never the
    // "Course unavailable" placeholder.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url) => {
        const u = String(url);
        if (u.includes('/api/sessions/validate')) {
          return Promise.resolve(jsonRes({ user: ADMIN }));
        }
        if (u.includes('/api/courses')) {
          return Promise.reject(new Error('Core unavailable'));
        }
        return Promise.resolve(jsonRes({}));
      }),
    );

    const second = await request(app).get('/api/course?page=1&pageSize=25').set(cookie());
    expect(second.status).toBe(200);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.data[0].name).toBe('Advanced Algorithms');
    expect(second.body.data[0].coreUnavailable).toBe(false);

    vi.unstubAllGlobals();
  });

  it('does not leak a cached catalog entry into a test that resets state first (cache-reset regression guard)', async () => {
    // Warm the cache with a course that must NOT be visible to the next test.
    vi.stubGlobal(
      'fetch',
      makeAdminFetch([
        jsonRes({
          data: [{ id: 'core-leak', name: 'Should Not Leak', code: 'LEAK000', department: 'COSC' }],
          total: 1,
          page: 1,
          pageSize: 200,
        }),
      ]),
    );
    const warmed = await request(app).get('/api/course?page=1&pageSize=25').set(cookie());
    expect(warmed.body.data[0].name).toBe('Should Not Leak');
    vi.unstubAllGlobals();

    // Explicitly reset, as the suite's beforeEach/afterEach does, then issue a
    // fresh request with a DIFFERENT catalog — proving the previous in-memory
    // cache entry is gone rather than silently reused.
    resetCourseAccessSyncForTests();
    await truncateTestDatabase();
    await prisma.user.create({ data: { id: ADMIN.id, email: ADMIN.email, name: ADMIN.name } });

    vi.stubGlobal(
      'fetch',
      makeAdminFetch([
        jsonRes({
          data: [{ id: 'core-fresh', name: 'Fresh Catalog Entry', code: 'FRESH001', department: 'MATH' }],
          total: 1,
          page: 1,
          pageSize: 200,
        }),
      ]),
    );
    const fresh = await request(app).get('/api/course?page=1&pageSize=25').set(cookie());
    expect(fresh.status).toBe(200);
    expect(fresh.body.data).toHaveLength(1);
    expect(fresh.body.data[0].name).toBe('Fresh Catalog Entry');
    expect(fresh.body.data.some((c) => c.name === 'Should Not Leak')).toBe(false);

    vi.unstubAllGlobals();
  });
});
