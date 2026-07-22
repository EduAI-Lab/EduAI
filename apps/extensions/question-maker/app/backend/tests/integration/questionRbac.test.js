/**
 * Route-level RBAC tests for question_metadata authoring (#311/#312, §16/§19):
 *   - STUDENT flat-gated off create/edit/delete,
 *   - TA own-only edit/delete (createdBy === caller).
 *
 * No DB / live Core: questionService, schema, and the RBAC Core reads are mocked.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const { mockUpdate, mockDelete, mockCreate, mockList, mockQuestionFindOne, mockCourseFindOne, mockEnrollments } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockDelete: vi.fn().mockResolvedValue(true),
  mockCreate: vi.fn(),
  mockList: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 }),
  mockQuestionFindOne: vi.fn(),
  mockCourseFindOne: vi.fn(),
  mockEnrollments: vi.fn(),
}));

vi.mock('../../src/services/authService.js', () => ({ findOrCreateUser: vi.fn().mockResolvedValue({}) }));

vi.mock('../../src/config/settings.js', () => {
  const cfg = { coreUrl: 'http://core.test', eduaiApiKey: 'k', corsOrigins: ['*'], nodeEnv: 'test', logLevel: 'silent' };
  return { config: cfg, default: cfg };
});

vi.mock('../../src/services/questionService.js', () => ({
  createQuestion: mockCreate,
  getQuestionsByUser: mockList,
  getQuestionById: vi.fn(),
  updateQuestion: mockUpdate,
  deleteQuestion: mockDelete,
  createMultipleQuestions: vi.fn(),
  getQuestionStats: vi.fn(),
  updateQuestionOrder: vi.fn(),
  removeQuestionFromAssessment: vi.fn(),
  saveExtractedQuestions: vi.fn(),
  normalizePrimaryTopicId: (v) => (v ? String(v) : null),
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

vi.mock('../../src/schema/index.js', () => ({
  Course: { findOne: mockCourseFindOne },
  Question_Metadata: { findOne: mockQuestionFindOne },
  Variants: {},
  Assessments: {},
  AssessmentSections: {},
  Topics: {},
  sequelize: { define: vi.fn(), authenticate: vi.fn(), sync: vi.fn() },
}));

const { default: app } = await import('../../src/app.js');

const TA = { id: 'ta-1', role: 'TA', email: 't@t.co', name: 'TA' };
const INSTRUCTOR = { id: 'inst-1', role: 'INSTRUCTOR', email: 'i@t.co', name: 'I' };
const STUDENT = { id: 'stu-1', role: 'STUDENT', email: 's@t.co', name: 'S' };

const COURSE = { id: 1, userId: 'owner-1', coreCourseId: 'cuid-core-course' };

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

describe('STUDENT flat-gated off question authoring (§16)', () => {
  it.each([
    ['post', '/api/questions', { courseId: 1, primaryTopicId: 't1', type: 'MCQ' }],
    ['put', '/api/questions/7', { description: 'x' }],
    ['delete', '/api/questions/7', {}],
  ])('%s %s → 403', async (method, path, body) => {
    authAs(STUDENT, null);
    const res = await request(app)[method](path).set('Cookie', 'session=v').send(body);
    expect(res.status).toBe(403);
  });
});

describe('TA blocked at platform role gate', () => {
  it.each([
    ['put', '/api/questions/7', { description: 'edit' }],
    ['delete', '/api/questions/7', {}],
    ['get', '/api/questions?courseId=1', {}],
    ['get', '/api/questions', {}],
  ])('%s %s → 403', async (method, path, body) => {
    authAs(TA, 'TA');
    const res = await request(app)[method](path).set('Cookie', 'session=v').send(body);
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
  });
});

describe('INSTRUCTOR may edit/delete any question in the course (C)', () => {
  it('edits a question created by someone else → 200', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    loadQuestion('ta-1');
    mockUpdate.mockResolvedValue({ id: 7 });
    const res = await request(app).put('/api/questions/7').set('Cookie', 'session=v').send({ description: 'edit' });
    expect(res.status).toBe(200);
  });

  it('creates a question and records createdBy = caller', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    mockCreate.mockResolvedValue({ id: 9 });
    const res = await request(app)
      .post('/api/questions')
      .set('Cookie', 'session=v')
      .send({ courseId: 1, primaryTopicId: 't1', type: 'MCQ', description: 'q' });
    expect(res.status).toBe(201);
    // scoped by course owner, authored by caller
    expect(mockCreate).toHaveBeenCalledWith('owner-1', expect.objectContaining({ createdBy: INSTRUCTOR.id, courseId: 1 }));
  });
});
