/**
 * Coverage-focused route tests for questions.js (issue #1217: questions.js was
 * the single largest uncovered file — 82 uncovered statements). questionRbac.test.js
 * already covers the STUDENT/TA platform-role gates and the INSTRUCTOR
 * edit-any-question case; this file exercises the remaining branches: stats/export
 * course-access gates, PUT/DELETE validation and TA-own-only enforcement, generate/
 * extract/extract-save/approve validation, and the order routes' assessment-in-course
 * check.
 *
 * Same mocked-DB pattern as questionRbac.test.js — no live Core or test DB required.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const {
  mockUpdate,
  mockDelete,
  mockCreate,
  mockList,
  mockStats,
  mockGetById,
  mockEnrich,
  mockCreateMultiple,
  mockUpdateOrder,
  mockRemoveFromAssessment,
  mockSaveExtracted,
  mockGenerateQuestions,
  mockExtractQuestions,
  mockQuestionFindOne,
  mockCourseFindOne,
  mockAssessmentFindOne,
  mockEnrollments,
} = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockDelete: vi.fn().mockResolvedValue(true),
  mockCreate: vi.fn(),
  mockList: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 }),
  mockStats: vi.fn().mockResolvedValue({ total: 0 }),
  mockGetById: vi.fn(),
  mockEnrich: vi.fn(async (rows) => rows),
  mockCreateMultiple: vi.fn(),
  mockUpdateOrder: vi.fn(),
  mockRemoveFromAssessment: vi.fn(),
  mockSaveExtracted: vi.fn(),
  mockGenerateQuestions: vi.fn(),
  mockExtractQuestions: vi.fn(),
  mockQuestionFindOne: vi.fn(),
  mockCourseFindOne: vi.fn(),
  mockAssessmentFindOne: vi.fn(),
  mockEnrollments: vi.fn(),
}));

vi.mock('../../src/services/authService.js', () => ({ findOrCreateUser: vi.fn().mockResolvedValue({}) }));

vi.mock('../../src/config/settings.js', () => {
  const cfg = {
    coreUrl: 'http://core.test',
    eduaiApiKey: 'k',
    corsOrigins: ['*'],
    nodeEnv: 'test',
    logLevel: 'silent',
    maxQuestions: 5,
  };
  return { config: cfg, default: cfg };
});

vi.mock('../../src/services/questionService.js', () => ({
  createQuestion: mockCreate,
  getQuestionsByUser: mockList,
  enrichQuestionRows: mockEnrich,
  getQuestionById: mockGetById,
  updateQuestion: mockUpdate,
  deleteQuestion: mockDelete,
  createMultipleQuestions: mockCreateMultiple,
  getQuestionStats: mockStats,
  updateQuestionOrder: mockUpdateOrder,
  removeQuestionFromAssessment: mockRemoveFromAssessment,
  saveExtractedQuestions: mockSaveExtracted,
  normalizePrimaryTopicId: (v) => (v ? String(v) : null),
}));

vi.mock('../../src/services/aiService.js', () => ({
  generateQuestions: mockGenerateQuestions,
  extractQuestionsFromText: mockExtractQuestions,
  AI_PROVIDERS: { GROQ: 'groq' },
}));

vi.mock('../../src/services/coreApiService.js', () => ({
  getCourseEnrollmentsFromCore: mockEnrollments,
  getCourseFromCore: vi.fn().mockResolvedValue({ id: 'cuid-core-course', department: 'COSC' }),
  getMyProfileFromCore: vi.fn().mockResolvedValue({ authorizedUnits: [] }),
}));

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    course: { findUnique: mockCourseFindOne },
    questionMetadata: { findUnique: mockQuestionFindOne },
    assessments: { findUnique: mockAssessmentFindOne },
    variants: {},
    assessmentSections: {},
    topics: {},
  },
}));

const { default: app } = await import('../../src/app.js');

const INSTRUCTOR = { id: 'inst-1', role: 'INSTRUCTOR', email: 'i@t.co', name: 'I' };
// Not the course owner and not enrolled — used to exercise the "insufficient
// course access" branch (the owner-fallback in resolveAccessForCourse only
// applies to the course's own userId).
const OUTSIDER_INSTRUCTOR = { id: 'inst-2', role: 'INSTRUCTOR', email: 'i2@t.co', name: 'I2' };

const COURSE = { id: 1, userId: 'inst-1', coreCourseId: 'cuid-core-course' };

function authAs(user, enrollRole) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ user }) }));
  mockEnrollments.mockResolvedValue({
    enrollments: enrollRole ? [{ studentId: user.id, role: enrollRole, isActive: true }] : [],
  });
  mockCourseFindOne.mockResolvedValue(COURSE);
}

function loadQuestion(createdBy) {
  mockQuestionFindOne.mockResolvedValue({ id: 7, createdBy, course: COURSE });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDelete.mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe('GET /api/questions/stats', () => {
  it('returns 404 when the course does not exist', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    mockCourseFindOne.mockResolvedValue(null);

    const res = await request(app).get('/api/questions/stats?courseId=999').set('Cookie', 'session=v');

    expect(res.status).toBe(404);
  });

  it('returns 403 when the caller lacks TA access', async () => {
    authAs(OUTSIDER_INSTRUCTOR, null);

    const res = await request(app).get('/api/questions/stats?courseId=1').set('Cookie', 'session=v');

    expect(res.status).toBe(403);
  });

  it('scopes stats by course when courseId is supplied', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    mockStats.mockResolvedValue({ total: 4 });

    const res = await request(app).get('/api/questions/stats?courseId=1').set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(mockStats).toHaveBeenCalledWith(COURSE.userId, { courseId: COURSE.id });
  });

  it('scopes stats to the caller when no courseId is supplied', async () => {
    authAs(INSTRUCTOR, null);
    mockStats.mockResolvedValue({ total: 1 });

    const res = await request(app).get('/api/questions/stats').set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(mockStats).toHaveBeenCalledWith(INSTRUCTOR.id, { courseId: undefined });
  });
});

describe('GET /api/questions/export', () => {
  it('requires courseId', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app).get('/api/questions/export').set('Cookie', 'session=v');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/courseId is required/);
  });

  it('rejects an unsupported format', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app)
      .get('/api/questions/export?courseId=1&format=xml')
      .set('Cookie', 'session=v');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/format must be/);
  });

  it('returns 404 when the course does not exist', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    mockCourseFindOne.mockResolvedValue(null);
    const res = await request(app).get('/api/questions/export?courseId=1').set('Cookie', 'session=v');
    expect(res.status).toBe(404);
  });

  it('returns 403 when the caller lacks TA access', async () => {
    authAs(OUTSIDER_INSTRUCTOR, null);
    const res = await request(app).get('/api/questions/export?courseId=1').set('Cookie', 'session=v');
    expect(res.status).toBe(403);
  });

  it('exports JSON by default', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    mockList.mockResolvedValueOnce({ items: [{ id: 1, type: 'MCQ' }], total: 1, limit: 500, offset: 0 });

    const res = await request(app).get('/api/questions/export?courseId=1').set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 1, type: 'MCQ' }]);
  });

  it('exports CSV with one row per variant, escaping embedded commas/quotes', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    mockList.mockResolvedValueOnce({
      items: [
        {
          id: 1,
          type: 'MCQ',
          description: 'Has, a comma',
          primaryTopicId: 't1',
          variants: [
            {
              id: 10,
              questionText: 'What is "pi"?',
              difficulty: 'easy',
              reasoningLevel: 'factual',
              answer: '3.14',
              choices: [{ letter: 'A', text: '3.14' }],
              isDraft: false,
              isAiGenerated: true,
            },
          ],
        },
        { id: 2, type: 'SA', description: 'No variants', primaryTopicId: 't2', variants: [] },
      ],
      total: 2,
      limit: 500,
      offset: 0,
    });

    const res = await request(app)
      .get('/api/questions/export?courseId=1&format=csv')
      .set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain('questions-course-1.csv');
    expect(res.text).toContain('"Has, a comma"');
    expect(res.text).toContain('"What is ""pi""?"');
    // Question with no variants still emits a row.
    expect(res.text.split('\r\n')).toHaveLength(3); // header + 2 rows
  });
});

describe('PUT /api/questions/:id', () => {
  // Note: denyTaNotOwner's "TAs can only modify their own questions" 403 branch
  // is currently unreachable via any real request — requireRole(QM_AUTHORIZED)
  // excludes TA entirely (see questionRbac.test.js's "TA blocked at platform
  // role gate" suite), so TA never reaches this handler. Not chased here.

  it('rejects a non-integer courseId', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    loadQuestion(INSTRUCTOR.id);

    const res = await request(app)
      .put('/api/questions/7')
      .set('Cookie', 'session=v')
      .send({ courseId: 'not-a-number' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Valid courseId is required/);
  });

  it('rejects an empty primaryTopicId', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    loadQuestion(INSTRUCTOR.id);

    const res = await request(app)
      .put('/api/questions/7')
      .set('Cookie', 'session=v')
      .send({ primaryTopicId: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Valid primaryTopicId is required/);
  });

  it('rejects an invalid type', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    loadQuestion(INSTRUCTOR.id);

    const res = await request(app)
      .put('/api/questions/7')
      .set('Cookie', 'session=v')
      .send({ type: 'ESSAY' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid question type/);
  });

  it('rejects an empty update payload', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    loadQuestion(INSTRUCTOR.id);

    const res = await request(app).put('/api/questions/7').set('Cookie', 'session=v').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No valid fields provided to update/);
  });

  it('applies questionOrder/isAiGenerated/isDraft updates', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    loadQuestion(INSTRUCTOR.id);
    mockUpdate.mockResolvedValue({ id: 7 });

    const res = await request(app)
      .put('/api/questions/7')
      .set('Cookie', 'session=v')
      .send({ questionOrder: { 1: 2 }, isAiGenerated: true, isDraft: false });

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      '7',
      COURSE.userId,
      expect.objectContaining({ questionOrder: { 1: 2 }, isAiGenerated: true, isDraft: false }),
    );
  });
});

// DELETE /api/questions/:id has no additional branches to cover beyond PUT's
// dead-code denyTaNotOwner note above and the shared resourceAccess gate.

describe('POST /api/questions/generate', () => {
  it('requires a prompt', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app).post('/api/questions/generate').set('Cookie', 'session=v').send({});
    expect(res.status).toBe(400);
  });

  it('rejects numQuestions above the configured max', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app)
      .post('/api/questions/generate')
      .set('Cookie', 'session=v')
      .send({ prompt: 'x', numQuestions: 999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot exceed/);
  });

  it('generates questions on success', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    mockGenerateQuestions.mockResolvedValue([{ id: 'q1' }]);

    const res = await request(app)
      .post('/api/questions/generate')
      .set('Cookie', 'session=v')
      .send({ prompt: 'Generate some questions', numQuestions: 3 });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 'q1' }]);
  });
});

describe('POST /api/questions/extract', () => {
  it('requires text content', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app)
      .post('/api/questions/extract')
      .set('Cookie', 'session=v')
      .send({ courseId: 1, text: '   ' });
    expect(res.status).toBe(400);
  });

  it('extracts questions on success', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    mockExtractQuestions.mockResolvedValue([{ id: 'extracted-1' }]);

    const res = await request(app)
      .post('/api/questions/extract')
      .set('Cookie', 'session=v')
      .send({ courseId: 1, text: 'Some OCR text' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 'extracted-1' }]);
  });
});

describe('POST /api/questions/extract/save', () => {
  it('requires at least one question', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app)
      .post('/api/questions/extract/save')
      .set('Cookie', 'session=v')
      .send({ courseId: 1, questions: [] });
    expect(res.status).toBe(400);
  });

  it('rejects more questions than the configured max', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const questions = Array.from({ length: 6 }, (_, i) => ({ description: `q${i}` }));
    const res = await request(app)
      .post('/api/questions/extract/save')
      .set('Cookie', 'session=v')
      .send({ courseId: 1, questions });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cannot save more than/);
  });

  it('saves extracted questions on success', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    mockSaveExtracted.mockResolvedValue({ questions: [{ id: 1 }, { id: 2 }] });

    const res = await request(app)
      .post('/api/questions/extract/save')
      .set('Cookie', 'session=v')
      .send({ courseId: 1, questions: [{ description: 'a' }, { description: 'b' }] });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(2);
  });
});

describe('POST /api/questions/approve', () => {
  it('requires a non-empty questions array', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app)
      .post('/api/questions/approve')
      .set('Cookie', 'session=v')
      .send({ questions: [] });
    expect(res.status).toBe(400);
  });

  it('rejects when a question is missing courseId/primaryTopicId', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app)
      .post('/api/questions/approve')
      .set('Cookie', 'session=v')
      .send({ questions: [{ description: 'no course or topic' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must include courseId and a valid primaryTopicId/);
  });

  it('saves multiple approved questions on success', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    mockCreateMultiple.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const res = await request(app)
      .post('/api/questions/approve')
      .set('Cookie', 'session=v')
      .send({
        courseId: 1,
        questions: [
          { primaryTopicId: 't1', description: 'a' },
          { primaryTopicId: 't2', description: 'b' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(2);
  });
});

describe('PUT /api/questions/:id/order', () => {
  it('requires assessmentId and orderNumber', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    loadQuestion(INSTRUCTOR.id);
    const res = await request(app)
      .put('/api/questions/7/order')
      .set('Cookie', 'session=v')
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 when the assessment does not belong to the authorized course', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    loadQuestion(INSTRUCTOR.id);
    mockAssessmentFindOne.mockResolvedValue({ id: 5, courseId: 999 });

    const res = await request(app)
      .put('/api/questions/7/order')
      .set('Cookie', 'session=v')
      .send({ assessmentId: 5, orderNumber: 1 });

    expect(res.status).toBe(404);
    expect(mockUpdateOrder).not.toHaveBeenCalled();
  });

  it('returns 404 for a non-integer assessmentId', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    loadQuestion(INSTRUCTOR.id);

    const res = await request(app)
      .put('/api/questions/7/order')
      .set('Cookie', 'session=v')
      .send({ assessmentId: 'not-a-number', orderNumber: 1 });

    expect(res.status).toBe(404);
  });

  it('updates the order on success', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    loadQuestion(INSTRUCTOR.id);
    mockAssessmentFindOne.mockResolvedValue({ id: 5, courseId: COURSE.id });
    mockUpdateOrder.mockResolvedValue({ id: 7, questionOrder: { 5: 1 } });

    const res = await request(app)
      .put('/api/questions/7/order')
      .set('Cookie', 'session=v')
      .send({ assessmentId: 5, orderNumber: 1 });

    expect(res.status).toBe(200);
    expect(mockUpdateOrder).toHaveBeenCalledWith('7', 5, 1, COURSE.userId);
  });
});

describe('DELETE /api/questions/:id/order/:assessmentId', () => {
  it('returns 404 when the assessment does not belong to the authorized course', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    loadQuestion(INSTRUCTOR.id);
    mockAssessmentFindOne.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/questions/7/order/5')
      .set('Cookie', 'session=v');

    expect(res.status).toBe(404);
    expect(mockRemoveFromAssessment).not.toHaveBeenCalled();
  });

  it('removes the question from the assessment order on success', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    loadQuestion(INSTRUCTOR.id);
    mockAssessmentFindOne.mockResolvedValue({ id: 5, courseId: COURSE.id });
    mockRemoveFromAssessment.mockResolvedValue({ id: 7 });

    const res = await request(app)
      .delete('/api/questions/7/order/5')
      .set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(mockRemoveFromAssessment).toHaveBeenCalledWith('7', '5', COURSE.userId);
  });
});

describe('GET /api/questions/:id', () => {
  it('returns the question after passing the resource access gate', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    loadQuestion(INSTRUCTOR.id);
    mockGetById.mockResolvedValue({ id: 7, description: 'x' });

    const res = await request(app).get('/api/questions/7').set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: 7, description: 'x' });
  });
});
