/**
 * Unit tests for the resource-access loaders' id guard (#5).
 *
 * A non-integer resource id (e.g. PATCH /api/questions/variants/abc/testable) must 404
 * BEFORE the loader issues a Sequelize query against an INTEGER PK — otherwise
 * `Number('abc')` → NaN reaches the DB as `invalid input syntax for type integer: NaN`,
 * which errorHandler doesn't map and leaks as a 500. The course-id path already guards
 * this via `Number.isInteger` (courseAccess.resolveCourseAccessWithCourse); the resource
 * loaders must do the same.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockVariantFindOne, mockQuestionFindOne, mockAssessmentFindOne } = vi.hoisted(() => ({
  mockVariantFindOne: vi.fn(),
  mockQuestionFindOne: vi.fn(),
  mockAssessmentFindOne: vi.fn(),
}));

vi.mock('../../src/config/settings.js', () => {
  const cfg = { coreUrl: 'http://core.test', eduaiApiKey: 'k', corsOrigins: ['*'], nodeEnv: 'test', logLevel: 'silent' };
  return { config: cfg, default: cfg };
});

vi.mock('../../src/services/coreApiService.js', () => ({
  getCourseEnrollmentsFromCore: vi.fn(),
  getCourseFromCore: vi.fn(),
  getMyProfileFromCore: vi.fn(),
}));

vi.mock('../../src/schema/index.js', () => ({
  Variants: { findOne: mockVariantFindOne },
  Question_Metadata: { findOne: mockQuestionFindOne },
  Assessments: { findOne: mockAssessmentFindOne },
  Course: {},
}));

const { requireVariantAccess, requireQuestionAccess, requireAssessmentAccess } = await import(
  '../../src/middleware/resourceAccess.js'
);

function mockRes() {
  return {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };
}

const USER = { id: 'cuid-user', role: 'INSTRUCTOR' };

beforeEach(() => vi.clearAllMocks());

describe('resource loaders reject non-integer ids before querying (#5)', () => {
  it('variant route: non-numeric variantId → 404, no DB query', async () => {
    const req = { user: USER, params: { variantId: 'abc' }, headers: {} };
    const res = mockRes();
    const next = vi.fn();

    await requireVariantAccess({ min: 'ta' })(req, res, next);

    expect(res.statusCode).toBe(404);
    expect(mockVariantFindOne).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('question route: non-numeric id → 404, no DB query', async () => {
    const req = { user: USER, params: { id: 'not-a-number' }, headers: {} };
    const res = mockRes();
    const next = vi.fn();

    await requireQuestionAccess({ min: 'ta' })(req, res, next);

    expect(res.statusCode).toBe(404);
    expect(mockQuestionFindOne).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('assessment route: non-numeric id → 404, no DB query', async () => {
    const req = { user: USER, params: { id: 'xyz' }, headers: {} };
    const res = mockRes();
    const next = vi.fn();

    await requireAssessmentAccess({ min: 'ta' })(req, res, next);

    expect(res.statusCode).toBe(404);
    expect(mockAssessmentFindOne).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
