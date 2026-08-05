/**
 * Coverage-focused route tests for canvas.js (issue #1217: canvas.js was one
 * of the worst-covered files at 45%). canvasRbac.test.js already covers the
 * role/course-access gates; this file exercises the remaining business-logic
 * branches: integration existence checks, connect validation (including the
 * SSRF guard's rejection branch), export/import validation and the
 * topic-must-exist-in-course check, and quiz browsing.
 *
 * Same mocked-DB pattern as canvasRbac.test.js — no live Core or test DB required.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const { canvas, mockCourseFindOne, mockAssessmentFindOne, mockEnrollments, mockTopicFindFirst, mockIntegrationDelete } =
  vi.hoisted(() => ({
    canvas: {
      getCanvasIntegration: vi.fn(),
      saveCanvasIntegration: vi.fn(),
      getCanvasCourses: vi.fn(),
      exportAssessmentToCanvas: vi.fn(),
      getCanvasCourseMapping: vi.fn(),
      getCanvasQuizzes: vi.fn(),
      getCanvasQuizQuestions: vi.fn(),
      importQuizFromCanvas: vi.fn(),
    },
    mockCourseFindOne: vi.fn(),
    mockAssessmentFindOne: vi.fn(),
    mockEnrollments: vi.fn(),
    mockTopicFindFirst: vi.fn(),
    mockIntegrationDelete: vi.fn(),
  }));

vi.mock('../../src/services/authService.js', () => ({ findOrCreateUser: vi.fn().mockResolvedValue({}) }));
vi.mock('../../src/config/settings.js', () => {
  const cfg = { coreUrl: 'http://core.test', eduaiApiKey: 'k', corsOrigins: ['*'], nodeEnv: 'test', logLevel: 'silent' };
  return { config: cfg, default: cfg };
});
vi.mock('../../src/services/canvasService.js', () => canvas);
vi.mock('../../src/services/coreApiService.js', () => ({
  getCourseEnrollmentsFromCore: mockEnrollments,
  getCourseFromCore: vi.fn().mockResolvedValue({ id: 'cuid-core-course', department: 'COSC' }),
  getMyProfileFromCore: vi.fn().mockResolvedValue({ authorizedUnits: [] }),
}));
vi.mock('../../src/config/database.js', () => ({
  prisma: {
    course: { findUnique: mockCourseFindOne },
    assessments: { findUnique: mockAssessmentFindOne },
    topics: { findFirst: mockTopicFindFirst },
    canvasIntegration: { delete: mockIntegrationDelete },
    questionMetadata: {},
    variants: {},
    assessmentSections: {},
  },
}));

const { default: app } = await import('../../src/app.js');

const INSTRUCTOR = { id: 'inst-1', role: 'INSTRUCTOR', email: 'i@t.co', name: 'I' };
const COURSE = { id: 1, userId: 'owner-1', coreCourseId: 'cuid-core-course' };

function authAs(user, enrollRole) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ user }) }));
  mockEnrollments.mockResolvedValue({
    enrollments: enrollRole ? [{ studentId: user.id, role: enrollRole, isActive: true }] : [],
  });
  mockCourseFindOne.mockResolvedValue(COURSE);
  mockAssessmentFindOne.mockResolvedValue({ id: 5, course: COURSE });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('GET /api/canvas/integration', () => {
  it('returns the connected integration (API key withheld)', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    canvas.getCanvasIntegration.mockResolvedValue({ canvasUrl: 'https://x.test', isTestMode: false, apiKey: 'secret' });

    const res = await request(app).get('/api/canvas/integration').set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ canvasUrl: 'https://x.test', isTestMode: false, isConnected: true });
    expect(res.body.data.apiKey).toBeUndefined();
  });
});

describe('POST /api/canvas/connect', () => {
  it('requires canvasUrl', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app).post('/api/canvas/connect').set('Cookie', 'session=v').send({});
    expect(res.status).toBe(400);
  });

  it('requires an apiKey unless test mode is enabled', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app)
      .post('/api/canvas/connect')
      .set('Cookie', 'session=v')
      .send({ canvasUrl: 'https://canvas.test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/API key is required/);
  });

  it('rejects an SSRF-targeting canvasUrl', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app)
      .post('/api/canvas/connect')
      .set('Cookie', 'session=v')
      .send({ canvasUrl: 'https://127.0.0.1', apiKey: 'k' });
    expect(res.status).toBe(400);
    expect(canvas.saveCanvasIntegration).not.toHaveBeenCalled();
  });

  it('allows test mode without an apiKey, using a placeholder', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    canvas.saveCanvasIntegration.mockResolvedValue({ canvasUrl: 'https://canvas.test', isTestMode: true });

    const res = await request(app)
      .post('/api/canvas/connect')
      .set('Cookie', 'session=v')
      .send({ canvasUrl: 'https://canvas.test', isTestMode: true });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/test mode/i);
    expect(canvas.saveCanvasIntegration).toHaveBeenCalledWith(
      INSTRUCTOR.id,
      expect.objectContaining({ apiKey: 'test-key', isTestMode: true }),
    );
  });
});

describe('DELETE /api/canvas/disconnect', () => {
  it('deletes the integration when one exists', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    canvas.getCanvasIntegration.mockResolvedValue({ canvasUrl: 'https://x.test' });

    const res = await request(app).delete('/api/canvas/disconnect').set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(mockIntegrationDelete).toHaveBeenCalledWith({ where: { userId: INSTRUCTOR.id } });
  });

  it('is a no-op when no integration exists', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    canvas.getCanvasIntegration.mockResolvedValue(null);

    const res = await request(app).delete('/api/canvas/disconnect').set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(mockIntegrationDelete).not.toHaveBeenCalled();
  });
});

describe('GET /api/canvas/courses', () => {
  it('lists Canvas courses via the caller integration', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    canvas.getCanvasCourses.mockResolvedValue([{ id: 'c1' }]);

    const res = await request(app).get('/api/canvas/courses').set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 'c1' }]);
  });
});

describe('POST /api/canvas/export/:assessmentId', () => {
  it('requires canvasCourseId', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app).post('/api/canvas/export/5').set('Cookie', 'session=v').send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /api/canvas/courses/:canvasCourseId/quizzes', () => {
  it('lists quizzes for the Canvas course', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    canvas.getCanvasQuizzes.mockResolvedValue([{ id: 'q1' }]);

    const res = await request(app).get('/api/canvas/courses/c1/quizzes').set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(canvas.getCanvasQuizzes).toHaveBeenCalledWith(INSTRUCTOR.id, 'c1');
  });
});

describe('GET /api/canvas/courses/:canvasCourseId/quizzes/:quizId/questions', () => {
  it('lists quiz questions', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    canvas.getCanvasQuizQuestions.mockResolvedValue([{ id: 'qq1' }]);

    const res = await request(app)
      .get('/api/canvas/courses/c1/quizzes/z1/questions')
      .set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(canvas.getCanvasQuizQuestions).toHaveBeenCalledWith(INSTRUCTOR.id, 'c1', 'z1');
  });
});

describe('POST /api/canvas/import/:canvasCourseId/quizzes/:quizId', () => {
  it('requires primaryTopicId', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app)
      .post('/api/canvas/import/c1/quizzes/z1')
      .set('Cookie', 'session=v')
      .send({ localCourseId: 1 });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the topic does not belong to the course', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    mockTopicFindFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/canvas/import/c1/quizzes/z1')
      .set('Cookie', 'session=v')
      .send({ localCourseId: 1, primaryTopicId: 'missing-topic' });

    expect(res.status).toBe(404);
    expect(canvas.importQuizFromCanvas).not.toHaveBeenCalled();
  });

  it('imports the quiz on success', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    mockTopicFindFirst.mockResolvedValue({ id: 'topic-1', courseId: COURSE.id });
    canvas.importQuizFromCanvas.mockResolvedValue({ assessmentId: 9 });

    const res = await request(app)
      .post('/api/canvas/import/c1/quizzes/z1')
      .set('Cookie', 'session=v')
      .send({ localCourseId: 1, primaryTopicId: 'topic-1', assessmentName: 'Imported Quiz' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ assessmentId: 9 });
    expect(canvas.importQuizFromCanvas).toHaveBeenCalledWith(
      INSTRUCTOR.id,
      'c1',
      'z1',
      COURSE.id,
      expect.objectContaining({ primaryTopicId: 'topic-1', assessmentName: 'Imported Quiz' }),
      COURSE.userId,
    );
  });
});
