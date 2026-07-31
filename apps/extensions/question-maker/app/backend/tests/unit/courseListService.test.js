/**
 * Unit tests for role-scoped QM course listing.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockFindMany = vi.fn();
const mockEnsureCourseAnchor = vi.fn();
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

const { listCoursesForUser, enrichCourseDetail } = await import(
  '../../src/services/courseListService.js'
);

describe('listCoursesForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
