import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const {
  mockCreateVariant,
  mockUpdateVariant,
  mockVariantsFindOne,
  mockQuestionFindOne,
  mockEnrollments,
} = vi.hoisted(() => ({
  mockCreateVariant: vi.fn(),
  mockUpdateVariant: vi.fn(),
  mockVariantsFindOne: vi.fn(),
  mockQuestionFindOne: vi.fn(),
  mockEnrollments: vi.fn(),
}));

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/config/settings.js', () => {
  const cfg = {
    coreUrl: 'http://core.test',
    eduaiApiKey: 'k',
    corsOrigins: ['*'],
    nodeEnv: 'test',
    logLevel: 'silent',
  };
  return { config: cfg, default: cfg };
});

vi.mock('../../src/services/questionService.js', () => ({
  createVariant: mockCreateVariant,
  updateVariant: mockUpdateVariant,
  deleteVariant: vi.fn(),
  getVariantsByQuestion: vi.fn(),
}));

vi.mock('../../src/services/coreWiringService.js', () => ({
  pushVariantToCore: vi.fn(),
  VALID_DIFFICULTIES: ['easy', 'medium', 'hard'],
  VALID_REASONING_LEVELS: ['factual', 'analytical', 'application'],
}));

vi.mock('../../src/services/coreApiService.js', () => ({
  getCourseEnrollmentsFromCore: mockEnrollments,
  getCourseFromCore: vi.fn().mockResolvedValue({ id: 'cuid-core-course', department: 'COSC' }),
  getMyProfileFromCore: vi.fn().mockResolvedValue({ authorizedUnits: [] }),
  patchQuestionTestableOnCore: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    variants: { findUnique: mockVariantsFindOne, update: vi.fn() },
    questionMetadata: { findUnique: mockQuestionFindOne },
    assessments: {},
    assessmentSections: {},
    course: {},
    topics: { updateMany: vi.fn() },
  },
}));

const { default: app } = await import('../../src/app.js');

const INSTRUCTOR = {
  id: 'cuid-instructor',
  email: 'inst@test.com',
  role: 'INSTRUCTOR',
  name: 'Instructor',
};

const COURSE = { id: 1, userId: 'cuid-owner', coreCourseId: 'cuid-core-course' };

const CHOICES = [
  { letter: 'A', text: 'At least 12 characters' },
  { letter: 'B', text: 'Mix of cases' },
  { letter: 'C', text: 'Common word' },
  { letter: 'D', text: 'Numbers and symbols' },
  { letter: 'E', text: 'Name or birthday' },
  { letter: 'F', text: 'Unique across accounts' },
];

function authInstructor() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: INSTRUCTOR }),
    }),
  );
  mockEnrollments.mockResolvedValue({
    enrollments: [{ studentId: INSTRUCTOR.id, role: 'INSTRUCTOR', isActive: true }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authInstructor();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('variant routes forward multi-correct MCQ fields (#1360)', () => {
  it('POST /api/questions/:id/variants passes selectAllThatApply + correctAnswers to createVariant', async () => {
    mockQuestionFindOne.mockResolvedValue({
      id: 5,
      type: 'MCQ',
      course: COURSE,
    });
    mockCreateVariant.mockResolvedValue({
      id: 99,
      answer: 'A',
      selectAllThatApply: true,
      correctAnswers: ['A', 'B', 'D', 'F'],
      choices: CHOICES,
    });

    const body = {
      questionText: 'Which are characteristics of a strong password? Select all that apply.',
      difficulty: 'medium',
      answer: 'A',
      choices: CHOICES,
      selectAllThatApply: true,
      correctAnswers: ['A', 'B', 'D', 'F'],
      isDraft: true,
    };

    const res = await request(app)
      .post('/api/questions/5/variants')
      .set('Cookie', 'session=valid')
      .send(body);

    expect(res.status).toBe(201);
    expect(mockCreateVariant).toHaveBeenCalledOnce();
    const [, variantData] = mockCreateVariant.mock.calls[0];
    expect(variantData).toEqual(
      expect.objectContaining({
        selectAllThatApply: true,
        correctAnswers: ['A', 'B', 'D', 'F'],
        answer: 'A',
        choices: CHOICES,
      }),
    );
  });

  it('PUT /api/questions/variants/:id passes selectAllThatApply + correctAnswers to updateVariant', async () => {
    mockVariantsFindOne.mockResolvedValue({
      id: 18,
      isDraft: true,
      createdBy: INSTRUCTOR.id,
      questionMetadata: { type: 'MCQ', course: COURSE },
    });
    mockUpdateVariant.mockResolvedValue({
      id: 18,
      answer: 'A',
      selectAllThatApply: true,
      correctAnswers: ['A', 'B', 'D', 'F'],
      choices: CHOICES,
      isDraft: true,
      questionMetadata: { type: 'MCQ', course: COURSE },
    });

    const body = {
      choices: CHOICES,
      answer: 'A',
      selectAllThatApply: true,
      correctAnswers: ['A', 'B', 'D', 'F'],
    };

    const res = await request(app)
      .put('/api/questions/variants/18')
      .set('Cookie', 'session=valid')
      .send(body);

    expect(res.status).toBe(200);
    expect(mockUpdateVariant).toHaveBeenCalledOnce();
    const [, variantData] = mockUpdateVariant.mock.calls[0];
    expect(variantData).toEqual(
      expect.objectContaining({
        selectAllThatApply: true,
        correctAnswers: ['A', 'B', 'D', 'F'],
        answer: 'A',
        choices: CHOICES,
      }),
    );
  });
});
