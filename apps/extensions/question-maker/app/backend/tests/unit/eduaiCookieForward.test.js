/**
 * Route-level tests: cookie-first Core auth must be forwarded on AI chat /
 * variant-review paths (#1009 review). Without the cookie, eduaiService falls
 * back to the unrestricted service key.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const {
  mockChat,
  variantSvc,
  mockCourseFindAll,
  mockCourseFindOne,
  mockEnrollments,
} = vi.hoisted(() => ({
  mockChat: vi.fn(),
  variantSvc: {
    setAssessmentStudyRole: vi.fn(),
    getBlueprintSnapshot: vi.fn(),
    getBaselineVariantReadiness: vi.fn(),
    assembleEquivalentExamVariants: vi.fn(),
    assembleExamVariantsByMetadataSimilarity: vi.fn(),
    generateBankVariantsForQuestions: vi.fn(),
    reviewVariantExamWithAi: vi.fn(),
  },
  mockCourseFindAll: vi.fn(),
  mockCourseFindOne: vi.fn(),
  mockEnrollments: vi.fn(),
}));

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/services/eduaiService.js', () => ({
  default: {
    chat: mockChat,
    generateQuestions: vi.fn(),
    isConfigured: () => true,
    listAIModels: vi.fn().mockResolvedValue([]),
    testApiKey: vi.fn(),
    listCourses: vi.fn(),
    getCourseTopics: vi.fn(),
  },
}));

vi.mock('../../src/services/assessmentVariantService.js', () => variantSvc);

vi.mock('../../src/config/settings.js', () => {
  const cfg = {
    coreUrl: 'http://core.test',
    eduaiApiKey: 'service-key',
    corsOrigins: ['*'],
    nodeEnv: 'test',
    logLevel: 'silent',
  };
  return { config: cfg, default: cfg };
});

vi.mock('../../src/services/coreApiService.js', () => ({
  // `resolveCourseCodeAccess` (routes/eduai.js) now matches on the Core-projected
  // code via `courseListService.findCoursesByProjectedCode` (#1072 §4 step 10 —
  // `Course.code` no longer exists locally), so it needs a Core course whose
  // `code`/`id` line up with `COURSE.coreCourseId` below.
  getAllCoursesFromCore: vi.fn().mockResolvedValue([{ id: 'cuid-core', code: 'COSC 101', name: 'Test Course' }]),
  getCourseEnrollmentsFromCore: mockEnrollments,
  getCourseFromCore: vi.fn().mockResolvedValue({ id: 'cuid-core', department: 'COSC' }),
  getMyProfileFromCore: vi.fn().mockResolvedValue({ authorizedUnits: [] }),
}));

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    course: {
      findUnique: mockCourseFindOne,
      findFirst: mockCourseFindOne,
      findMany: mockCourseFindAll,
    },
    assessments: { findFirst: vi.fn(), findUnique: vi.fn() },
    questionMetadata: {},
    variants: {},
    assessmentSections: {},
    topics: {},
  },
}));

const { default: app } = await import('../../src/app.js');

const TEST_USER = {
  id: 'cuid-test-user',
  email: 'test@test.com',
  role: 'INSTRUCTOR',
  name: 'Test User',
};
const SESSION_COOKIE = '__Secure-better-auth.session_token=abc123';
const COURSE = { id: 1, userId: TEST_USER.id, code: 'COSC 101', coreCourseId: 'cuid-core' };

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: TEST_USER }),
    }),
  );
  mockCourseFindAll.mockResolvedValue([COURSE]);
  mockChat.mockResolvedValue({ content: 'ok' });
  variantSvc.reviewVariantExamWithAi.mockResolvedValue({ perQuestion: [] });
  mockCourseFindOne.mockResolvedValue(COURSE);
  mockEnrollments.mockResolvedValue({
    enrollments: [{ studentId: TEST_USER.id, role: 'INSTRUCTOR', isActive: true }],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Cookie forwarding for EduAI AI routes (#1009)', () => {
  it('POST /api/eduai/chat forwards the session cookie to eduaiService.chat', async () => {
    const res = await request(app)
      .post('/api/eduai/chat')
      .set('Cookie', SESSION_COOKIE)
      .send({
        messages: [{ role: 'user', content: 'Hi' }],
        courseCode: 'COSC 101',
      });

    expect(res.status).toBe(200);
    expect(mockChat).toHaveBeenCalledTimes(1);
    expect(mockChat.mock.calls[0][0]).toMatchObject({
      courseCode: 'COSC 101',
      cookie: SESSION_COOKIE,
    });
  });

  it('POST /api/assessment-variant/review-variant-ai forwards the session cookie', async () => {
    const res = await request(app)
      .post('/api/assessment-variant/review-variant-ai')
      .set('Cookie', SESSION_COOKIE)
      .send({
        courseId: 1,
        baselineAssessmentId: 10,
        variantAssessmentId: 11,
      });

    expect(res.status).toBe(200);
    expect(variantSvc.reviewVariantExamWithAi).toHaveBeenCalledTimes(1);
    const params = variantSvc.reviewVariantExamWithAi.mock.calls[0][1];
    expect(params).toMatchObject({
      baselineAssessmentId: 10,
      variantAssessmentId: 11,
      courseId: 1,
      cookie: SESSION_COOKIE,
    });
  });
});
