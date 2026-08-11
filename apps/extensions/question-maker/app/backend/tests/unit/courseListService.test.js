/**
 * Unit tests for role-scoped QM course listing.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockFindMany = vi.fn();
const mockEnsureCourseAnchor = vi.fn();
const mockCount = vi.fn();
const mockCreateMany = vi.fn();
const mockCourseAccessDeleteMany = vi.fn();
const mockCourseAccessCreateMany = vi.fn();
const mockGetAllCoursesFromCore = vi.fn();
const mockGetCoursesByIdsFromCore = vi.fn();
const mockSearchCoursesFromCore = vi.fn();
const mockListCoursesFromCore = vi.fn();
const mockGetAuthorizedUnits = vi.fn();
const mockGetCourseFromCore = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    course: {
      findMany: (...args) => mockFindMany(...args),
      count: (...args) => mockCount(...args),
      createMany: (...args) => mockCreateMany(...args),
    },
    courseAccess: {
      deleteMany: (...args) => mockCourseAccessDeleteMany(...args),
      createMany: (...args) => mockCourseAccessCreateMany(...args),
    },
  },
}));

vi.mock('../../src/services/ensureCourseAnchor.js', () => ({
  ensureCourseAnchor: (...args) => mockEnsureCourseAnchor(...args),
}));

vi.mock('../../src/middleware/courseAccess.js', () => ({
  LEVELS: {
    admin: { level: 'admin', rank: 4 },
    unit: { level: 'unit', rank: 3 },
    instructor: { level: 'instructor', rank: 2 },
    ta: { level: 'ta', rank: 1 },
    student: { level: 'student', rank: 0 },
  },
  getAuthorizedUnits: (...args) => mockGetAuthorizedUnits(...args),
}));

vi.mock('../../src/services/coreApiService.js', () => ({
  getAllCoursesFromCore: (...args) => mockGetAllCoursesFromCore(...args),
  getCoursesByIdsFromCore: (...args) => mockGetCoursesByIdsFromCore(...args),
  searchCoursesFromCore: (...args) => mockSearchCoursesFromCore(...args),
  getCourseFromCore: (...args) => mockGetCourseFromCore(...args),
  listCoursesFromCore: (...args) => mockListCoursesFromCore(...args),
}));

const {
  listCoursesForUser,
  listCoursesPageForUser,
  resetCourseAccessSyncForTests,
  enrichCourseDetail,
} = await import(
  '../../src/services/courseListService.js'
);

describe('listCoursesForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockReset();
    mockFindMany.mockResolvedValue([]);
    mockCount.mockReset();
    const CORE_CATALOG = [
      { id: 'core-1', name: 'Core Course One', code: 'STUDY3', department: 'COSC' },
      { id: 'core-2', name: 'Core Course Two', code: 'MATH100', department: 'MATH' },
    ];
    mockGetAllCoursesFromCore.mockResolvedValue(CORE_CATALOG);
    // #1041/#1125: non-ADMIN callers resolve Core fields through the `?ids=`
    // lookup instead of pulling the whole catalog.
    mockGetCoursesByIdsFromCore.mockImplementation(async (ids) =>
      CORE_CATALOG.filter((c) => (ids ?? []).includes(c.id)),
    );
    mockSearchCoursesFromCore.mockResolvedValue(CORE_CATALOG);
    // The cookie-scoped list is unwrapped to a plain array (#1041).
    mockListCoursesFromCore.mockResolvedValue([]);
    mockGetAuthorizedUnits.mockResolvedValue([]);
    mockGetCourseFromCore.mockResolvedValue({ id: 'core-1', name: 'Core Course One' });
    mockCount.mockResolvedValue(0);
    mockCourseAccessDeleteMany.mockReset();
    mockCourseAccessDeleteMany.mockResolvedValue({ count: 0 });
    mockCourseAccessCreateMany.mockReset();
    mockCourseAccessCreateMany.mockResolvedValue({ count: 0 });
    resetCourseAccessSyncForTests();
  });

  describe('listCoursesPageForUser (#1206)', () => {
    it('refreshes access once, then applies the same SQL visibility predicate to count and page', async () => {
      mockListCoursesFromCore.mockResolvedValue([
        { id: 'core-1', callerEnrollmentRole: 'INSTRUCTOR', department: 'COSC' },
      ]);
      mockFindMany
        .mockResolvedValueOnce([{ id: 10, coreCourseId: 'core-1' }])
        .mockResolvedValueOnce([{
          id: 10,
          userId: 'other-owner',
          coreCourseId: 'core-1',
          accessGrants: [{ role: 'INSTRUCTOR', department: 'COSC' }],
        }]);
      mockCount.mockResolvedValue(3);

      const result = await listCoursesPageForUser(
        { id: 'instructor-1', role: 'INSTRUCTOR' },
        { cookie: 'session=x', pagination: { offset: 2, limit: 1 } },
      );

      expect(result.total).toBe(3);
      expect(result.courses).toHaveLength(1);
      expect(result.courses[0].accessLevel).toBe('instructor');
      expect(mockCourseAccessDeleteMany).toHaveBeenCalledWith({ where: { userId: 'instructor-1' } });
      expect(mockCourseAccessCreateMany).toHaveBeenCalledWith({
        data: [{ userId: 'instructor-1', courseId: 10, role: 'INSTRUCTOR', department: 'COSC' }],
        skipDuplicates: true,
      });

      const countWhere = mockCount.mock.calls[0][0].where;
      const pageQuery = mockFindMany.mock.calls[1][0];
      expect(pageQuery.where).toEqual(countWhere);
      expect(pageQuery.skip).toBe(2);
      expect(pageQuery.take).toBe(1);
      expect(pageQuery.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    });

    it('keeps a department-only course visible to a UNIT_ADMIN when callerEnrollmentRole is null (#1410 review)', async () => {
      // Core can return an authorized-unit course with no personal
      // enrollment role — that is still a valid grant for a UNIT_ADMIN and
      // must not be dropped from the synced access mirror.
      mockListCoursesFromCore.mockResolvedValue([
        { id: 'core-1', callerEnrollmentRole: null, department: 'COSC' },
      ]);
      mockGetAuthorizedUnits.mockResolvedValue(['COSC']);
      mockFindMany
        .mockResolvedValueOnce([{ id: 10, coreCourseId: 'core-1' }])
        .mockResolvedValueOnce([{
          id: 10,
          userId: 'other-owner',
          coreCourseId: 'core-1',
          accessGrants: [{ role: 'NONE', department: 'COSC' }],
        }]);
      mockCount.mockResolvedValue(1);

      const result = await listCoursesPageForUser(
        { id: 'unit-admin-1', role: 'UNIT_ADMIN' },
        { cookie: 'session=x', pagination: { offset: 0, limit: 25 } },
      );

      expect(result.total).toBe(1);
      expect(result.courses).toHaveLength(1);
      expect(result.courses[0].accessLevel).toBe('unit');
      // The department-only grant is persisted even without an enrollment role.
      expect(mockCourseAccessCreateMany).toHaveBeenCalledWith({
        data: [{ userId: 'unit-admin-1', courseId: 10, role: 'NONE', department: 'COSC' }],
        skipDuplicates: true,
      });
      const pageWhere = mockFindMany.mock.calls[1][0].where;
      expect(pageWhere.OR).toContainEqual({
        accessGrants: { some: { userId: 'unit-admin-1', department: { in: ['COSC'] } } },
      });
    });

    it('does not refresh Core access again while the caller snapshot is fresh', async () => {
      mockFindMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockCount.mockResolvedValue(0);

      const user = { id: 'instructor-ttl', role: 'INSTRUCTOR' };
      const options = { cookie: 'session=x', pagination: { offset: 0, limit: 25 } };
      await listCoursesPageForUser(user, options);
      await listCoursesPageForUser(user, options);

      expect(mockListCoursesFromCore).toHaveBeenCalledTimes(1);
    });

    it('fails closed for non-owners when the Core access refresh fails', async () => {
      mockListCoursesFromCore.mockRejectedValue(new Error('Core unavailable'));
      mockFindMany.mockResolvedValue([{
        id: 10,
        userId: 'other-owner',
        coreCourseId: 'core-1',
        accessGrants: [{ role: 'INSTRUCTOR', department: 'COSC' }],
      }]);
      mockCount.mockResolvedValue(0);

      await listCoursesPageForUser(
        { id: 'former-instructor', role: 'INSTRUCTOR' },
        { cookie: 'session=x', pagination: { offset: 0, limit: 25 } },
      );

      const pageQuery = mockFindMany.mock.calls[0][0];
      // The owner-fallback branch is restricted to `coreCourseId: null` when
      // the mirror is unhealthy, so a caller who owns no unlinked course
      // still gets a (correctly unsatisfiable-by-them) `userId` clause.
      expect(pageQuery.where).toEqual({
        OR: [{ userId: 'former-instructor', coreCourseId: null }],
      });
      expect(pageQuery.include).toEqual({});
    });

    it('excludes a linked course from owner fallback when the Core access refresh fails (fail closed)', async () => {
      // #1410 review: a linked course's real access can't be verified
      // locally once Core is unreachable, so an owner must NOT get automatic
      // fallback visibility into it — only their QM-native (unlinked) courses.
      mockListCoursesFromCore.mockRejectedValue(new Error('Core unavailable'));
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await listCoursesPageForUser(
        { id: 'linked-owner', role: 'INSTRUCTOR' },
        { cookie: 'session=x', pagination: { offset: 0, limit: 25 } },
      );

      const countWhere = mockCount.mock.calls[0][0].where;
      const pageWhere = mockFindMany.mock.calls[0][0].where;
      // The predicate itself proves a linked course owned by the caller
      // cannot match: the owner branch requires `coreCourseId: null`, and
      // every other OR branch is dropped while the mirror is unhealthy.
      expect(countWhere).toEqual({ OR: [{ userId: 'linked-owner', coreCourseId: null }] });
      expect(pageWhere).toEqual(countWhere);
    });

    it('excludes a linked course owned by the caller with no synced grant, even when the mirror is healthy (#1270 review)', async () => {
      // The Core refresh succeeds, but this particular linked course produced
      // no CourseAccess row for the caller (never enrolled, or since
      // unenrolled in Core) — ownership alone must not resurrect visibility.
      mockListCoursesFromCore.mockResolvedValue([]);
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await listCoursesPageForUser(
        { id: 'former-instructor', role: 'INSTRUCTOR' },
        { cookie: 'session=x', pagination: { offset: 0, limit: 25 } },
      );

      const pageWhere = mockFindMany.mock.calls[0][0].where;
      // The owner branch requires `coreCourseId: null` unconditionally now —
      // a linked course owned by the caller can only match via a real
      // `accessGrants` clause, never through ownership by itself.
      expect(pageWhere.OR[0]).toEqual({ userId: 'former-instructor', coreCourseId: null });
    });

    it('reuses the cached ADMIN catalog while resolving only the current page, without a second Core request', async () => {
      mockGetAllCoursesFromCore.mockResolvedValue([{ id: 'core-1', name: 'Course' }]);
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      const user = { id: 'admin-1', role: 'ADMIN' };
      const options = { pagination: { offset: 0, limit: 25 } };
      await listCoursesPageForUser(user, options);
      await listCoursesPageForUser(user, options);

      // Only the one catalog fetch inside `listCoursesForUser` (TTL-cached
      // across both calls) — #1410 review: a second, separately-failable
      // `getCoursesByIdsFromCore` request must not be made for ADMIN, since
      // it could clobber names the cached catalog already resolved.
      expect(mockGetAllCoursesFromCore).toHaveBeenCalledTimes(1);
      expect(mockGetCoursesByIdsFromCore).not.toHaveBeenCalled();
    });

    it('does not overwrite valid ADMIN names with a placeholder when Core is unreachable for a later request (#1410 review)', async () => {
      // First call succeeds and warms the shared catalog cache; a later Core
      // outage must not corrupt names the cache already resolved.
      mockGetAllCoursesFromCore.mockResolvedValueOnce([
        { id: 'core-1', name: 'Real Course Name', code: 'STUDY3' },
      ]);
      mockFindMany.mockResolvedValue([{ id: 10, userId: 'admin-1', coreCourseId: 'core-1' }]);
      mockCount.mockResolvedValue(1);

      const user = { id: 'admin-1', role: 'ADMIN' };
      const options = { pagination: { offset: 0, limit: 25 } };

      const first = await listCoursesPageForUser(user, options);
      expect(first.courses[0].name).toBe('Real Course Name');

      // Simulate Core going down for any *new* request (getCoursesByIdsFromCore),
      // while the already-cached catalog is still warm.
      mockGetCoursesByIdsFromCore.mockRejectedValue(new Error('Core unavailable'));
      const second = await listCoursesPageForUser(user, options);

      expect(second.courses[0].name).toBe('Real Course Name');
      expect(second.courses[0].coreUnavailable).toBe(false);
      expect(mockGetCoursesByIdsFromCore).not.toHaveBeenCalled();
    });
  });

  describe('enrichCourseDetail (#1072 detail-fetch: service-key mode, not preferCookie)', () => {
    it('calls getCourseFromCore with preferCookie: false even when a caller cookie is present', async () => {
      const row = { id: 1, coreCourseId: 'core-1' };

      await enrichCourseDetail(row, { cookie: 'session=abc' });

      expect(mockGetCourseFromCore).toHaveBeenCalledWith('core-1', {
        cookie: 'session=abc',
        preferCookie: false,
      });
    });

    it('degrades to a placeholder when the service-key/cookie read throws', async () => {
      mockGetCourseFromCore.mockRejectedValueOnce(new Error('Core unavailable'));
      const row = { id: 1, coreCourseId: 'core-1' };

      const detail = await enrichCourseDetail(row, { cookie: 'session=abc' });

      expect(detail.coreUnavailable).toBe(true);
      expect(detail.name).toBe('Course unavailable');
    });
  });

  it('returns Core catalog for ADMIN when every Core course already has a local anchor', async () => {
    mockFindMany.mockResolvedValue([
      { id: 1, coreCourseId: 'core-1' },
      { id: 2, coreCourseId: 'core-1' },
      { id: 3, coreCourseId: 'core-2' },
    ]);

    const rows = await listCoursesForUser({ id: 'admin-1', role: 'ADMIN' });
    // Local rows 1 and 2 both link to the same Core course (core-1) — name/code
    // live only on Core now (#1072 §4 step 10: `Course` dropped the columns),
    // so they dedupe to one row on Core's identity; core-2's anchor (row 3)
    // stays distinct. No missing anchors here, so no materialization.
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.accessLevel === 'admin')).toBe(true);
    expect(rows.map((r) => r.department).sort()).toEqual(['COSC', 'MATH']);
    expect(mockEnsureCourseAnchor).not.toHaveBeenCalled();
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    // ADMIN's branch never touches the cookie-scoped roles call.
    expect(mockListCoursesFromCore).not.toHaveBeenCalled();
  });

  it('degrades to a placeholder when Core is unreachable', async () => {
    mockGetAllCoursesFromCore.mockRejectedValue(new Error('Core unavailable'));
    mockFindMany.mockResolvedValue([{ id: 1, coreCourseId: 'core-1' }]);

    const rows = await listCoursesForUser({ id: 'admin-1', role: 'ADMIN' });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Course unavailable');
    expect(rows[0].code).toBeNull();
    expect(rows[0].coreUnavailable).toBe(true);
  });

  it('degrades to a placeholder for a course not yet linked to Core', async () => {
    // Should be unreachable in practice post-sandbox-removal (#1072 step 7 —
    // creation always sets coreCourseId), but `Course` has no local name/code
    // to fall back to either way now that the columns are gone (step 10).
    mockFindMany.mockResolvedValue([{ id: 1, coreCourseId: null }]);

    const rows = await listCoursesForUser({ id: 'admin-1', role: 'ADMIN' });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Course unavailable');
    expect(rows[0].code).toBeNull();
    expect(rows[0].coreUnavailable).toBe(true);
  });

  describe('ADMIN catalog materialization (#1074)', () => {
    it('materializes an anchor for every Core course missing one via ensureCourseAnchor', async () => {
      mockFindMany
        .mockResolvedValueOnce([{ id: 1, coreCourseId: 'core-1' }])
        .mockResolvedValueOnce([
          { id: 1, coreCourseId: 'core-1' },
          { id: 2, coreCourseId: 'core-2' },
        ]);
      mockEnsureCourseAnchor.mockResolvedValue({
        course: { id: 2, userId: 'admin-7', coreCourseId: 'core-2' },
        created: true,
      });

      const rows = await listCoursesForUser({ id: 'admin-7', role: 'ADMIN' });

      // Only the missing id (core-2) is ensured — core-1 already has a local
      // anchor — and it's materialized owned by the requesting admin.
      expect(mockEnsureCourseAnchor).toHaveBeenCalledTimes(1);
      expect(mockEnsureCourseAnchor).toHaveBeenCalledWith('admin-7', 'core-2');
      // First findMany supplies the "existing anchors" read for free (no extra
      // query); the second is the post-materialize re-fetch.
      expect(mockFindMany).toHaveBeenCalledTimes(2);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.name).sort()).toEqual(['Core Course One', 'Core Course Two']);
    });

    it('is a no-op on a second call once every Core course already has an anchor (idempotent)', async () => {
      mockFindMany.mockResolvedValue([
        { id: 1, coreCourseId: 'core-1' },
        { id: 2, coreCourseId: 'core-2' },
      ]);

      const rows = await listCoursesForUser({ id: 'admin-7', role: 'ADMIN' });

      expect(mockEnsureCourseAnchor).not.toHaveBeenCalled();
      expect(mockFindMany).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(2);
    });

    it('does not materialize when Core is unreachable — degrades to existing local anchors only', async () => {
      mockGetAllCoursesFromCore.mockRejectedValue(new Error('Core unavailable'));
      mockFindMany.mockResolvedValue([{ id: 1, coreCourseId: 'core-1' }]);

      const rows = await listCoursesForUser({ id: 'admin-7', role: 'ADMIN' });

      expect(mockEnsureCourseAnchor).not.toHaveBeenCalled();
      expect(mockFindMany).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].coreUnavailable).toBe(true);
    });

    it('does not fail the whole list when one anchor backfill rejects (#1270 review: allSettled, not Promise.all)', async () => {
      const bigCatalog = [
        { id: 'core-1', name: 'Course One', code: 'C1', department: 'COSC' },
        { id: 'core-2', name: 'Course Two', code: 'C2', department: 'COSC' },
      ];
      mockGetAllCoursesFromCore.mockResolvedValue(bigCatalog);
      mockFindMany
        .mockResolvedValueOnce([]) // no local anchors yet — both are missing
        .mockResolvedValueOnce([{ id: 2, coreCourseId: 'core-2' }]); // only core-2 landed
      mockEnsureCourseAnchor.mockImplementation(async (_userId, coreCourseId) => {
        if (coreCourseId === 'core-1') throw new Error('P2024: pool timeout');
        return { course: { id: 2, userId: 'admin-7', coreCourseId: 'core-2' }, created: true };
      });

      const rows = await listCoursesForUser({ id: 'admin-7', role: 'ADMIN' });

      // Must not throw despite one rejection — the request degrades to
      // whatever backfilled successfully instead of 500ing the whole list.
      expect(mockEnsureCourseAnchor).toHaveBeenCalledTimes(2);
      expect(rows).toHaveLength(1);
      expect(rows[0].code).toBe('C2');
    });

    it('processes every missing anchor across multiple batches when the catalog exceeds the batch size', async () => {
      const missingCount = 20; // > ADMIN_ANCHOR_BACKFILL_BATCH_SIZE (8)
      const bigCatalog = Array.from({ length: missingCount }, (_, i) => ({
        id: `core-${i}`,
        name: `Course ${i}`,
        code: `C${i}`,
        department: 'COSC',
      }));
      mockGetAllCoursesFromCore.mockResolvedValue(bigCatalog);
      mockFindMany
        .mockResolvedValueOnce([]) // nothing anchored locally yet
        .mockResolvedValueOnce(bigCatalog.map((c, i) => ({ id: i, coreCourseId: c.id })));
      mockEnsureCourseAnchor.mockImplementation(async (_userId, coreCourseId) => ({
        course: { id: coreCourseId, userId: 'admin-7', coreCourseId },
        created: true,
      }));

      const rows = await listCoursesForUser({ id: 'admin-7', role: 'ADMIN' });

      expect(mockEnsureCourseAnchor).toHaveBeenCalledTimes(missingCount);
      expect(rows).toHaveLength(missingCount);
    });
  });

  describe('non-ADMIN access derivation (#1072 unified contract — no per-row Core call)', () => {
    it('makes exactly one ids lookup and one cookie-scoped roles call, regardless of row count', async () => {
      mockFindMany.mockResolvedValue([
        { id: 1, userId: 'inst-1', coreCourseId: 'core-1' },
        { id: 2, userId: 'inst-1', coreCourseId: 'core-2' },
        { id: 3, userId: 'someone-else', coreCourseId: 'core-1' },
      ]);
      mockListCoursesFromCore.mockResolvedValue([
          { id: 'core-1', callerEnrollmentRole: 'INSTRUCTOR' },
          { id: 'core-2', callerEnrollmentRole: 'INSTRUCTOR' },
        ]);

      await listCoursesForUser({ id: 'inst-1', role: 'INSTRUCTOR' }, { cookie: 'session=x' });

      // Non-ADMIN: one `?ids=` lookup for fields, one cookie-scoped walk for roles.
      expect(mockGetAllCoursesFromCore).not.toHaveBeenCalled();
      expect(mockGetCoursesByIdsFromCore).toHaveBeenCalledTimes(1);
      expect(mockListCoursesFromCore).toHaveBeenCalledTimes(1);
      expect(mockListCoursesFromCore).toHaveBeenCalledWith('session=x', { all: true });
    });

    it('grants instructor access from an INSTRUCTOR callerEnrollmentRole', async () => {
      mockFindMany.mockResolvedValue([{ id: 1, userId: 'other-owner', coreCourseId: 'core-1' }]);
      mockListCoursesFromCore.mockResolvedValue([{ id: 'core-1', callerEnrollmentRole: 'INSTRUCTOR' }]);

      const rows = await listCoursesForUser({ id: 'inst-1', role: 'INSTRUCTOR' });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(1);
      expect(rows[0].accessLevel).toBe('instructor');
      // Name/code are read through from Core exclusively (#1076/#1072 §4 step 10).
      expect(rows[0].name).toBe('Core Course One');
      expect(rows[0].code).toBe('STUDY3');
    });

    it('excludes a course where the caller has a TA callerEnrollmentRole (below MIN_LIST_RANK)', async () => {
      mockFindMany.mockResolvedValue([{ id: 1, userId: 'other-owner', coreCourseId: 'core-1' }]);
      mockListCoursesFromCore.mockResolvedValue([{ id: 'core-1', callerEnrollmentRole: 'TA' }]);

      const rows = await listCoursesForUser({ id: 'ta-1', role: 'TA' });
      expect(rows).toHaveLength(0);
    });

    it('excludes a course where the caller has a STUDENT callerEnrollmentRole (below MIN_LIST_RANK)', async () => {
      mockFindMany.mockResolvedValue([{ id: 1, userId: 'other-owner', coreCourseId: 'core-1' }]);
      mockListCoursesFromCore.mockResolvedValue([{ id: 'core-1', callerEnrollmentRole: 'STUDENT' }]);

      const rows = await listCoursesForUser({ id: 'stu-1', role: 'STUDENT' });
      expect(rows).toHaveLength(0);
    });

    it('denies the local owner when absent from the cookie-scoped list (#1114 fail-closed)', async () => {
      // Mirrors the unpublished-student edge and the "linker not yet in Core
      // roster" edge: the cookie list omits the course — ownership alone must
      // not keep the anchor visible.
      mockFindMany.mockResolvedValue([{ id: 1, userId: 'owner-1', coreCourseId: 'core-1' }]);
      mockListCoursesFromCore.mockResolvedValue([]);

      const rows = await listCoursesForUser({ id: 'owner-1', role: 'INSTRUCTOR' });
      expect(rows).toHaveLength(0);
    });

    it('denies a non-owner absent from the cookie-scoped list', async () => {
      mockFindMany.mockResolvedValue([{ id: 1, userId: 'owner-1', coreCourseId: 'core-1' }]);
      mockListCoursesFromCore.mockResolvedValue([]);

      const rows = await listCoursesForUser({ id: 'stranger-1', role: 'INSTRUCTOR' });
      expect(rows).toHaveLength(0);
    });

    it('denies an unlinked course even for the local owner (#1114)', async () => {
      mockFindMany.mockResolvedValue([{ id: 1, userId: 'owner-1', coreCourseId: null }]);

      const rows = await listCoursesForUser({ id: 'owner-1', role: 'INSTRUCTOR' });
      expect(rows).toHaveLength(0);
    });

    it('fails closed for every row when Core is unreachable for the cookie-scoped call (#1114)', async () => {
      mockFindMany.mockResolvedValue([
        { id: 1, userId: 'owner-1', coreCourseId: 'core-1' },
        { id: 2, userId: 'stranger', coreCourseId: 'core-2' },
      ]);
      mockListCoursesFromCore.mockRejectedValue(new Error('Core unreachable'));

      const rows = await listCoursesForUser({ id: 'owner-1', role: 'INSTRUCTOR' });
      expect(rows).toHaveLength(0);
    });

    describe('UNIT_ADMIN unit lock', () => {
      it('grants unit access when the course department (read from the catalog) is in authorizedUnits, without a listCoursesFromCore role match', async () => {
        mockFindMany.mockResolvedValue([{ id: 1, userId: 'someone-else', coreCourseId: 'core-1' }]);
        mockGetAuthorizedUnits.mockResolvedValue(['COSC']);
        mockListCoursesFromCore.mockResolvedValue([]);

        const rows = await listCoursesForUser({ id: 'ua-1', role: 'UNIT_ADMIN' });
        expect(rows).toHaveLength(1);
        expect(rows[0].accessLevel).toBe('unit');
        // Department came from the already-fetched service-key catalog — no
        // extra per-row Core call was needed to resolve the unit lock.
      });

      it('falls through to callerEnrollmentRole when the department is outside their units', async () => {
        mockFindMany.mockResolvedValue([{ id: 1, userId: 'someone-else', coreCourseId: 'core-2' }]);
        mockGetAuthorizedUnits.mockResolvedValue(['COSC']);
        mockListCoursesFromCore.mockResolvedValue([{ id: 'core-2', callerEnrollmentRole: 'INSTRUCTOR' }]);

        const rows = await listCoursesForUser({ id: 'ua-1', role: 'UNIT_ADMIN' });
        expect(rows).toHaveLength(1);
        expect(rows[0].accessLevel).toBe('instructor');
      });

      it('does not call getAuthorizedUnits for non-UNIT_ADMIN callers', async () => {
        mockFindMany.mockResolvedValue([{ id: 1, userId: 'inst-1', coreCourseId: 'core-1' }]);
        mockListCoursesFromCore.mockResolvedValue([{ id: 'core-1', callerEnrollmentRole: 'INSTRUCTOR' }]);

        await listCoursesForUser({ id: 'inst-1', role: 'INSTRUCTOR' });
        expect(mockGetAuthorizedUnits).not.toHaveBeenCalled();
      });
    });
  });
});
