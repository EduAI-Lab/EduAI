/**
 * Route-level SSRF guard tests for POST /api/canvas/connect (#991): a
 * private/link-local/loopback IP or a non-HTTPS scheme must be rejected
 * before the URL is ever persisted. No DB / live Core: canvasService, schema,
 * and RBAC Core reads are mocked (same shape as canvasRbac.test.js).
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const { canvas, mockCourseFindOne, mockEnrollments } = vi.hoisted(() => ({
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
  mockEnrollments: vi.fn(),
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
vi.mock('../../src/schema/index.js', () => ({
  Course: { findOne: mockCourseFindOne },
  Assessments: { findOne: vi.fn() },
  Question_Metadata: {},
  Variants: {},
  AssessmentSections: {},
  Topics: {},
  sequelize: { define: vi.fn(), authenticate: vi.fn(), sync: vi.fn() },
}));

const { default: app } = await import('../../src/app.js');

const INSTRUCTOR = { id: 'inst-1', role: 'INSTRUCTOR', email: 'i@t.co', name: 'I' };

function authAsInstructor() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ user: INSTRUCTOR }) }));
  mockEnrollments.mockResolvedValue({ enrollments: [{ studentId: INSTRUCTOR.id, role: 'INSTRUCTOR', isActive: true }] });
  mockCourseFindOne.mockResolvedValue({ id: 1, userId: 'owner-1', coreCourseId: 'cuid-core-course' });
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsInstructor();
});
afterEach(() => vi.restoreAllMocks());

describe('POST /api/canvas/connect — SSRF guard (#991)', () => {
  it.each([
    ['cloud metadata IP', 'https://169.254.169.254/'],
    ['loopback IP', 'https://127.0.0.1/'],
    ['private 10/8', 'https://10.1.2.3/'],
    ['private 192.168/16', 'https://192.168.1.1/'],
    ['non-HTTPS scheme', 'http://canvas.example.com/'],
  ])('rejects %s (%s) with 400 and never persists it', async (_label, canvasUrl) => {
    const res = await request(app)
      .post('/api/canvas/connect')
      .set('Cookie', 'session=v')
      .send({ canvasUrl, isTestMode: true });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false });
    expect(canvas.saveCanvasIntegration).not.toHaveBeenCalled();
  });

  it('accepts a valid https Canvas URL and persists it', async () => {
    canvas.saveCanvasIntegration.mockResolvedValue({ canvasUrl: 'https://canvas.example.com', isTestMode: true });

    const res = await request(app)
      .post('/api/canvas/connect')
      .set('Cookie', 'session=v')
      .send({ canvasUrl: 'https://canvas.example.com', isTestMode: true });

    expect(res.status).toBe(200);
    expect(canvas.saveCanvasIntegration).toHaveBeenCalledWith(
      INSTRUCTOR.id,
      expect.objectContaining({ canvasUrl: 'https://canvas.example.com' }),
    );
  });
});
