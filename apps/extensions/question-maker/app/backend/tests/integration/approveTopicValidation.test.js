/**
 * Route-level test for POST /api/questions/approve topic validation (#4).
 *
 * Topics use CUID string PKs and question_metadata.primary_topic_id is a real FK to
 * topics.id. The old `primaryTopicId: q.primaryTopicId ?? 1` default coerced a missing
 * topic to "1", which matches no topic and (the FK being enforced) blows up the insert →
 * 500, partially committing the batch. The route must instead reject a missing/invalid
 * topic id up front with a 400, exactly like POST /api/questions does.
 *
 * No DB / live Core: questionService, schema, and the Core reads are mocked.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const { mockCreateMultiple, mockEnrollments } = vi.hoisted(() => ({
  mockCreateMultiple: vi.fn(),
  mockEnrollments: vi.fn(),
}));

vi.mock('../../src/services/authService.js', () => ({ findOrCreateUser: vi.fn().mockResolvedValue({}) }));
vi.mock('../../src/config/settings.js', () => {
  const cfg = { coreUrl: 'http://core.test', eduaiApiKey: 'k', corsOrigins: ['*'], nodeEnv: 'test', logLevel: 'silent' };
  return { config: cfg, default: cfg };
});
vi.mock('../../src/services/questionService.js', () => ({
  createQuestion: vi.fn(),
  getQuestionsByUser: vi.fn(),
  getQuestionById: vi.fn(),
  updateQuestion: vi.fn(),
  deleteQuestion: vi.fn(),
  createMultipleQuestions: mockCreateMultiple,
  getQuestionStats: vi.fn(),
  updateQuestionOrder: vi.fn(),
  removeQuestionFromAssessment: vi.fn(),
  saveExtractedQuestions: vi.fn(),
  // Mirror the real normalizer: trimmed string or null; never invents an id.
  normalizePrimaryTopicId: (v) => {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v));
    return null;
  },
}));
vi.mock('../../src/services/aiService.js', () => ({
  generateQuestions: vi.fn(),
  extractQuestionsFromText: vi.fn(),
  AI_PROVIDERS: { GROQ: 'groq' },
}));
vi.mock('../../src/services/coreApiService.js', () => ({
  getCourseEnrollmentsFromCore: mockEnrollments,
  getCourseFromCore: vi.fn().mockResolvedValue({ id: 'cuid-core-course', department: 'COSC' }),
  getMyProfileFromCore: vi.fn().mockResolvedValue({ authorizedUnits: [] }),
}));
vi.mock('../../src/config/database.js', () => ({
  prisma: {
    course: { findUnique: vi.fn() },
    questionMetadata: { findFirst: vi.fn() },
    variants: {},
    assessments: {},
    assessmentSections: {},
    topics: {},
  },
}));

const { default: app } = await import('../../src/app.js');

const INSTRUCTOR = { id: 'inst-1', role: 'INSTRUCTOR', email: 'i@t.co', name: 'I' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ user: INSTRUCTOR }) }));
});
afterEach(() => vi.restoreAllMocks());

describe('POST /api/questions/approve topic validation (#4)', () => {
  it('rejects a question with no primaryTopicId → 400, never reaching the service', async () => {
    const res = await request(app)
      .post('/api/questions/approve')
      .set('Cookie', 'session=v')
      .send({ questions: [{ courseId: 1, description: 'Q', type: 'MCQ' }] });

    expect(res.status).toBe(400);
    expect(String(res.body.error || '')).toMatch(/topic/i);
    expect(mockCreateMultiple).not.toHaveBeenCalled();
  });

  it('accepts questions that carry a real topic id and forwards it unchanged', async () => {
    mockCreateMultiple.mockResolvedValue([{ id: 9 }]);
    const res = await request(app)
      .post('/api/questions/approve')
      .set('Cookie', 'session=v')
      .send({ questions: [{ courseId: 1, primaryTopicId: 'ckcuidtopic123', description: 'Q', type: 'MCQ' }] });

    expect(res.status).toBe(201);
    expect(mockCreateMultiple).toHaveBeenCalledWith(
      INSTRUCTOR.id,
      expect.arrayContaining([expect.objectContaining({ primaryTopicId: 'ckcuidtopic123' })])
    );
  });
});
