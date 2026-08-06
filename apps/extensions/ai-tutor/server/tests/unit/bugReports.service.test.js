import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockActivityFindUnique = vi.fn();
const mockLessonFindUnique = vi.fn();
const mockModuleFindUnique = vi.fn();
const mockCourseOfferingFindUnique = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    activity: { findUnique: (...args) => mockActivityFindUnique(...args) },
    lesson: { findUnique: (...args) => mockLessonFindUnique(...args) },
    module: { findUnique: (...args) => mockModuleFindUnique(...args) },
    courseOffering: { findUnique: (...args) => mockCourseOfferingFindUnique(...args) },
  },
}));

const mockListCoreAdminBugReports = vi.fn();
const mockGetCoreAdminBugReport = vi.fn();
const mockPatchCoreAdminBugReportStatus = vi.fn();
const mockPostCoreBugReport = vi.fn();

vi.mock('../../src/services/eduaiClient.js', () => ({
  listCoreAdminBugReports: (...args) => mockListCoreAdminBugReports(...args),
  getCoreAdminBugReport: (...args) => mockGetCoreAdminBugReport(...args),
  patchCoreAdminBugReportStatus: (...args) => mockPatchCoreAdminBugReportStatus(...args),
  postCoreBugReport: (...args) => mockPostCoreBugReport(...args),
}));

const {
  BugReportError,
  createBugReport,
  listAdminBugReports,
  getAdminBugReport,
  validateBugReportStatus,
  updateBugReportStatus,
  BUG_REPORT_STATUSES,
} = await import('../../src/services/bugReports.js');

beforeEach(() => {
  mockActivityFindUnique.mockReset();
  mockLessonFindUnique.mockReset();
  mockModuleFindUnique.mockReset();
  mockCourseOfferingFindUnique.mockReset();
  mockListCoreAdminBugReports.mockReset();
  mockGetCoreAdminBugReport.mockReset();
  mockPatchCoreAdminBugReportStatus.mockReset();
  mockPostCoreBugReport.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const STUDENT = { id: 'user-1', role: 'STUDENT' };
const INSTRUCTOR = { id: 'user-2', role: 'INSTRUCTOR' };

function validPayload(overrides = {}) {
  return {
    description: 'This button does not do anything when I click it.',
    ...overrides,
  };
}

describe('BugReportError', () => {
  it('carries a status field', () => {
    const err = new BugReportError(404, 'not found');
    expect(err.status).toBe(404);
    expect(err.message).toBe('not found');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('createBugReport — content validation', () => {
  it('throws 400 when description is missing/non-string', async () => {
    await expect(createBugReport(STUDENT, {})).rejects.toMatchObject({ status: 400 });
  });

  it('throws 400 when description is under 10 characters', async () => {
    await expect(createBugReport(STUDENT, validPayload({ description: 'short' }))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('throws 400 when description exceeds 2000 characters', async () => {
    await expect(
      createBugReport(STUDENT, validPayload({ description: 'x'.repeat(2001) })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('trims the description before validating length', async () => {
    mockPostCoreBugReport.mockResolvedValue(null);
    await createBugReport(STUDENT, validPayload({ description: `   ${'a'.repeat(15)}   ` }));
    expect(mockPostCoreBugReport).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ description: 'a'.repeat(15) }),
    );
  });

  it('throws 400 for an invalid bugType', async () => {
    await expect(
      createBugReport(STUDENT, validPayload({ bugType: 'NOT_A_REAL_TYPE' })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('accepts a null bugType', async () => {
    mockPostCoreBugReport.mockResolvedValue(null);
    await createBugReport(STUDENT, validPayload({ bugType: null }));
    expect(mockPostCoreBugReport).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ bugType: null }),
    );
  });

  it('accepts a valid bugType', async () => {
    mockPostCoreBugReport.mockResolvedValue(null);
    await createBugReport(STUDENT, validPayload({ bugType: 'PERFORMANCE' }));
    expect(mockPostCoreBugReport).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ bugType: 'PERFORMANCE' }),
    );
  });

  it('throws 400 when consoleLogs is not a string', async () => {
    await expect(createBugReport(STUDENT, validPayload({ consoleLogs: 42 }))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('throws 400 when isAnonymous is not a boolean', async () => {
    await expect(createBugReport(STUDENT, validPayload({ isAnonymous: 'yes' }))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('defaults isAnonymous to false when omitted', async () => {
    mockPostCoreBugReport.mockResolvedValue(null);
    await createBugReport(STUDENT, validPayload());
    expect(mockPostCoreBugReport).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ isAnonymous: false }),
    );
  });
});

describe('createBugReport — context hierarchy validation', () => {
  it('throws 400 when activityId is present without lessonId', async () => {
    await expect(
      createBugReport(STUDENT, validPayload({ context: { activityId: 1 } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('throws 400 when lessonId is present without moduleId', async () => {
    await expect(
      createBugReport(STUDENT, validPayload({ context: { lessonId: 1 } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('throws 400 when moduleId is present without courseOfferingId', async () => {
    await expect(
      createBugReport(STUDENT, validPayload({ context: { moduleId: 1 } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('throws 400 when a context id is non-numeric', async () => {
    await expect(
      createBugReport(STUDENT, validPayload({ context: { courseOfferingId: 'abc' } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('proceeds with no DB lookup when context is entirely empty', async () => {
    mockPostCoreBugReport.mockResolvedValue(null);
    await createBugReport(STUDENT, validPayload({ context: {} }));
    expect(mockActivityFindUnique).not.toHaveBeenCalled();
    expect(mockCourseOfferingFindUnique).not.toHaveBeenCalled();
  });
});

describe('createBugReport — activityId context branch', () => {
  const context = { courseOfferingId: 1, moduleId: 2, lessonId: 3, activityId: 4 };

  it('throws 400 when the activity does not exist', async () => {
    mockActivityFindUnique.mockResolvedValue(null);
    await expect(createBugReport(STUDENT, validPayload({ context }))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('throws 400 when parent ids are inconsistent with the DB row', async () => {
    mockActivityFindUnique.mockResolvedValue({
      lessonId: 3,
      lesson: { moduleId: 99, module: { courseOfferingId: 1, courseOffering: { instructors: [], enrollments: [] } } },
    });
    await expect(createBugReport(STUDENT, validPayload({ context }))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('throws 403 for a student not enrolled in the course', async () => {
    mockActivityFindUnique.mockResolvedValue({
      lessonId: 3,
      lesson: {
        moduleId: 2,
        module: { courseOfferingId: 1, courseOffering: { instructors: [], enrollments: [] } },
      },
    });
    await expect(createBugReport(STUDENT, validPayload({ context }))).rejects.toMatchObject({
      status: 403,
    });
  });

  it('succeeds for an enrolled student', async () => {
    mockActivityFindUnique.mockResolvedValue({
      lessonId: 3,
      lesson: {
        moduleId: 2,
        module: {
          courseOfferingId: 1,
          courseOffering: { instructors: [], enrollments: [{ userId: 'user-1' }] },
        },
      },
    });
    mockPostCoreBugReport.mockResolvedValue(null);

    await createBugReport(STUDENT, validPayload({ context }));

    expect(mockPostCoreBugReport).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ context }),
    );
  });

  it('throws 403 for an instructor who does not teach the course', async () => {
    mockActivityFindUnique.mockResolvedValue({
      lessonId: 3,
      lesson: {
        moduleId: 2,
        module: { courseOfferingId: 1, courseOffering: { instructors: [], enrollments: [] } },
      },
    });
    await expect(createBugReport(INSTRUCTOR, validPayload({ context }))).rejects.toMatchObject({
      status: 403,
    });
  });

  it('throws 403 for a role that is neither STUDENT nor INSTRUCTOR', async () => {
    mockActivityFindUnique.mockResolvedValue({
      lessonId: 3,
      lesson: {
        moduleId: 2,
        module: {
          courseOfferingId: 1,
          courseOffering: { instructors: [], enrollments: [{ userId: 'admin-1' }] },
        },
      },
    });
    await expect(
      createBugReport({ id: 'admin-1', role: 'ADMIN' }, validPayload({ context })),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('createBugReport — lessonId-only context branch', () => {
  const context = { courseOfferingId: 1, moduleId: 2, lessonId: 3, activityId: null };

  it('throws 400 when the lesson does not exist', async () => {
    mockLessonFindUnique.mockResolvedValue(null);
    await expect(createBugReport(STUDENT, validPayload({ context }))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('throws 400 when parent ids mismatch', async () => {
    mockLessonFindUnique.mockResolvedValue({
      moduleId: 999,
      module: { courseOfferingId: 1, courseOffering: { instructors: [], enrollments: [] } },
    });
    await expect(createBugReport(STUDENT, validPayload({ context }))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('succeeds for an instructor who teaches the course', async () => {
    mockLessonFindUnique.mockResolvedValue({
      moduleId: 2,
      module: {
        courseOfferingId: 1,
        courseOffering: { instructors: [{ userId: 'user-2' }], enrollments: [] },
      },
    });
    mockPostCoreBugReport.mockResolvedValue(null);

    await createBugReport(INSTRUCTOR, validPayload({ context }));
    expect(mockPostCoreBugReport).toHaveBeenCalled();
  });
});

describe('createBugReport — moduleId-only context branch', () => {
  const context = { courseOfferingId: 1, moduleId: 2, lessonId: null, activityId: null };

  it('throws 400 when the module does not exist', async () => {
    mockModuleFindUnique.mockResolvedValue(null);
    await expect(createBugReport(STUDENT, validPayload({ context }))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('throws 400 when courseOfferingId mismatches', async () => {
    mockModuleFindUnique.mockResolvedValue({
      courseOfferingId: 999,
      courseOffering: { instructors: [], enrollments: [] },
    });
    await expect(createBugReport(STUDENT, validPayload({ context }))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('succeeds for an enrolled student', async () => {
    mockModuleFindUnique.mockResolvedValue({
      courseOfferingId: 1,
      courseOffering: { instructors: [], enrollments: [{ userId: 'user-1' }] },
    });
    mockPostCoreBugReport.mockResolvedValue(null);

    await createBugReport(STUDENT, validPayload({ context }));
    expect(mockPostCoreBugReport).toHaveBeenCalled();
  });
});

describe('createBugReport — bare courseOfferingId context branch', () => {
  const context = { courseOfferingId: 1, moduleId: null, lessonId: null, activityId: null };

  it('throws 400 when the course does not exist', async () => {
    mockCourseOfferingFindUnique.mockResolvedValue(null);
    await expect(createBugReport(STUDENT, validPayload({ context }))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('throws 403 when the student is not enrolled', async () => {
    mockCourseOfferingFindUnique.mockResolvedValue({ instructors: [], enrollments: [] });
    await expect(createBugReport(STUDENT, validPayload({ context }))).rejects.toMatchObject({
      status: 403,
    });
  });

  it('succeeds for an enrolled student and forwards to Core', async () => {
    mockCourseOfferingFindUnique.mockResolvedValue({
      instructors: [],
      enrollments: [{ userId: 'user-1' }],
    });
    mockPostCoreBugReport.mockResolvedValue(null);

    await createBugReport(STUDENT, validPayload({ context, pageUrl: '/course/1', userAgent: 'UA' }));

    expect(mockPostCoreBugReport).toHaveBeenCalledWith('user-1', {
      description: expect.any(String),
      bugType: null,
      consoleLogs: null,
      networkLogs: null,
      screenshot: null,
      pageUrl: '/course/1',
      userAgent: 'UA',
      isAnonymous: false,
      context,
    });
  });
});

describe('listAdminBugReports', () => {
  it('requests AI_TUTOR-scoped reports and maps each row', async () => {
    mockListCoreAdminBugReports.mockResolvedValue({
      reports: [
        {
          id: 'br-1',
          status: 'UNHANDLED',
          description: 'desc',
          isAnonymous: false,
          userId: 'u1',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const rows = await listAdminBugReports('cookie=abc');

    expect(mockListCoreAdminBugReports).toHaveBeenCalledWith('cookie=abc', {
      source: 'AI_TUTOR',
      limit: 100,
      offset: 0,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'br-1', status: 'unhandled' });
  });

  it('returns an empty array when Core answers without a reports array', async () => {
    mockListCoreAdminBugReports.mockResolvedValue({});
    const rows = await listAdminBugReports('cookie=abc');
    expect(rows).toEqual([]);
  });
});

describe('getAdminBugReport', () => {
  it('throws 400 for an empty bug report id', async () => {
    await expect(getAdminBugReport('cookie=abc', '   ')).rejects.toMatchObject({ status: 400 });
  });

  it('throws 400 for a non-string bug report id', async () => {
    await expect(getAdminBugReport('cookie=abc', 42)).rejects.toMatchObject({ status: 400 });
  });

  it('returns the mapped report when source is AI_TUTOR', async () => {
    mockGetCoreAdminBugReport.mockResolvedValue({
      id: 'br-1',
      source: 'AI_TUTOR',
      status: 'RESOLVED',
      description: 'desc',
      isAnonymous: false,
      userId: 'u1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const row = await getAdminBugReport('cookie=abc', ' br-1 ');

    expect(mockGetCoreAdminBugReport).toHaveBeenCalledWith('cookie=abc', 'br-1');
    expect(row).toMatchObject({ id: 'br-1', status: 'resolved' });
  });

  it('throws 404 when the report belongs to a different source', async () => {
    mockGetCoreAdminBugReport.mockResolvedValue({ id: 'br-1', source: 'CORE' });
    await expect(getAdminBugReport('cookie=abc', 'br-1')).rejects.toMatchObject({ status: 404 });
  });

  it('passes through a 404 from Core as a BugReportError', async () => {
    mockGetCoreAdminBugReport.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
    await expect(getAdminBugReport('cookie=abc', 'br-missing')).rejects.toMatchObject({ status: 404 });
    await expect(getAdminBugReport('cookie=abc', 'br-missing')).rejects.toBeInstanceOf(BugReportError);
  });

  it('rethrows non-404 upstream errors unchanged', async () => {
    const upstream = Object.assign(new Error('core down'), { status: 500 });
    mockGetCoreAdminBugReport.mockRejectedValue(upstream);
    await expect(getAdminBugReport('cookie=abc', 'br-1')).rejects.toBe(upstream);
  });
});

describe('validateBugReportStatus', () => {
  it('accepts every known status', () => {
    for (const status of BUG_REPORT_STATUSES) {
      expect(validateBugReportStatus(status)).toBe(status);
    }
  });

  it('throws 400 for an unknown status', () => {
    expect(() => validateBugReportStatus('bogus')).toThrow(BugReportError);
    try {
      validateBugReportStatus('bogus');
    } catch (e) {
      expect(e.status).toBe(400);
    }
  });

  it('throws 400 for a non-string status', () => {
    expect(() => validateBugReportStatus(null)).toThrow(BugReportError);
  });
});

describe('updateBugReportStatus', () => {
  it('throws 400 for an invalid id', async () => {
    await expect(updateBugReportStatus('', 'resolved', 'cookie')).rejects.toMatchObject({ status: 400 });
  });

  it('throws 400 for an invalid status before calling Core', async () => {
    await expect(updateBugReportStatus('br-1', 'bogus', 'cookie')).rejects.toMatchObject({
      status: 400,
    });
    expect(mockPatchCoreAdminBugReportStatus).not.toHaveBeenCalled();
  });

  it('patches Core with the mapped enum status and returns id/status', async () => {
    mockPatchCoreAdminBugReportStatus.mockResolvedValue({
      id: 'br-1',
      status: 'RESOLVED',
      description: 'old',
    });

    const result = await updateBugReportStatus('br-1', 'resolved', 'cookie=abc');

    expect(mockPatchCoreAdminBugReportStatus).toHaveBeenCalledWith('cookie=abc', 'br-1', 'RESOLVED');
    expect(result).toEqual({ id: 'br-1', status: 'resolved' });
  });

  it('throws 404 when Core returns no id after patch', async () => {
    mockPatchCoreAdminBugReportStatus.mockResolvedValue(null);
    await expect(updateBugReportStatus('br-1', 'resolved', 'cookie=abc')).rejects.toMatchObject({
      status: 404,
    });
  });
});
