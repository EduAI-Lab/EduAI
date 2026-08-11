/** Regression tests for bounded Canvas egress and Link pagination. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';

const axiosRequest = vi.fn();
const integrationFindOne = vi.fn();

vi.mock('axios', () => ({ default: axiosRequest }));
vi.mock('../../src/services/assessmentService.js', () => ({
  getAssessmentById: vi.fn(),
  createAssessment: vi.fn(),
}));
vi.mock('../../src/services/questionService.js', () => ({ createQuestion: vi.fn() }));
vi.mock('../../src/services/assessmentSectionService.js', () => ({ createAssessmentSection: vi.fn() }));
vi.mock('../../src/config/database.js', () => ({
  prisma: {
    canvasIntegration: { findUnique: integrationFindOne },
    canvasCourseMapping: { findUnique: vi.fn(), create: vi.fn() },
    questionMetadata: {},
    variants: {},
    assessmentSections: {},
    sectionVariants: {},
    course: {},
  },
}));
vi.mock('../../src/config/settings.js', () => ({
  config: {
    canvasRequestTimeoutMs: 100,
    canvasOperationTimeoutMs: 1_000,
    canvasMaxResponseBytes: 64,
    canvasMaxCompressedResponseBytes: 64,
    canvasMaxRequestBodyBytes: 64,
    canvasMaxPages: 4,
    canvasMaxItems: 8,
  },
  default: {},
}));

const { getCanvasCourses, getCanvasQuizzes } = await import('../../src/services/canvasService.js');
const { config } = await import('../../src/config/settings.js');

beforeEach(() => {
  vi.clearAllMocks();
  integrationFindOne.mockResolvedValue({
    isTestMode: false,
    canvasUrl: 'https://canvas.example.edu',
    apiKey: 'secret-token',
  });
});

describe('Canvas request limits and cancellation', () => {
  it('threads caller cancellation and finite response/request limits to Axios', async () => {
    const controller = new AbortController();
    axiosRequest.mockResolvedValue({ data: [] });

    await getCanvasCourses(42, { signal: controller.signal });

    const requestConfig = axiosRequest.mock.calls[0][0];
    expect(requestConfig.signal).toBeInstanceOf(AbortSignal);
    expect(requestConfig.signal.aborted).toBe(false);
    expect(requestConfig.timeout).toBeGreaterThan(0);
    expect(requestConfig.maxContentLength).toBe(64);
    expect(requestConfig.maxBodyLength).toBe(64);
  });

  it('rejects an oversized response body instead of returning it unbounded', async () => {
    axiosRequest.mockResolvedValue({ data: Buffer.alloc(65, 'x') });

    await expect(getCanvasCourses(42)).rejects.toThrow(/response.*(large|size|limit)/i);
  });

  it('enforces the decompressed cap on a small compressed wire body', async () => {
    axiosRequest.mockResolvedValue({
      data: gzipSync(Buffer.alloc(128, 'x')),
      headers: { 'content-encoding': 'gzip' },
    });

    await expect(getCanvasCourses(42)).rejects.toThrow(/decompressed|size|limit/i);
  });

  it('cancels an adapter that never resolves when the caller aborts', async () => {
    axiosRequest.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = getCanvasCourses(42, { signal: controller.signal });
    setTimeout(() => controller.abort(new DOMException('stop', 'AbortError')), 5);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('maps an Axios transport timeout to a bounded 504 deadline error', async () => {
    axiosRequest.mockRejectedValue({ code: 'ECONNABORTED', message: 'secret timeout details' });

    const thrown = await getCanvasCourses(42).catch((error) => error);
    expect(thrown).toMatchObject({ name: 'CanvasDeadlineError', code: 'CANVAS_DEADLINE_EXCEEDED', status: 504 });
    expect(thrown.message).not.toContain('secret timeout details');
  });
});

describe('Canvas Link pagination', () => {
  it('aggregates every assignment quiz page', async () => {
    axiosRequest
      .mockResolvedValueOnce({
        data: [{ id: 1, quiz_type: 'assignment' }],
        headers: { link: '<https://canvas.example.edu/api/v1/courses/9/quizzes?page=2>; rel="next"' },
      })
      .mockResolvedValueOnce({
        data: [{ id: 2, quiz_type: 'assignment' }],
        headers: {},
      });

    await expect(getCanvasQuizzes(42, 9)).resolves.toEqual([
      { id: 1, quiz_type: 'assignment' },
      { id: 2, quiz_type: 'assignment' },
    ]);
    expect(axiosRequest).toHaveBeenCalledTimes(2);
  });

  it('rejects a cross-origin next link instead of silently returning a partial list', async () => {
    axiosRequest.mockResolvedValue({
      data: [{ id: 1, quiz_type: 'assignment' }],
      headers: { link: '<https://evil.example/api/v1/courses/9/quizzes?page=2>; rel="next"' },
    });

    await expect(getCanvasQuizzes(42, 9)).rejects.toThrow(/next|origin|Canvas/i);
    expect(axiosRequest).toHaveBeenCalledTimes(1);
  });

  it('rejects a pagination cycle instead of returning duplicate/partial pages', async () => {
    axiosRequest.mockResolvedValue({
      data: [{ id: 1, quiz_type: 'assignment' }],
      headers: { link: '<https://canvas.example.edu/api/v1/courses/9/quizzes>; rel="next"' },
    });

    await expect(getCanvasQuizzes(42, 9)).rejects.toThrow(/cycle|pagination/i);
    expect(axiosRequest).toHaveBeenCalledTimes(1);
  });

  it('fails when the page count exceeds the configured bound', async () => {
    config.canvasMaxPages = 1;
    axiosRequest
      .mockResolvedValueOnce({
        data: [{ id: 1, quiz_type: 'assignment' }],
        headers: { link: '<https://canvas.example.edu/api/v1/courses/9/quizzes?page=2>; rel="next"' },
      })
      .mockResolvedValueOnce({ data: [{ id: 2, quiz_type: 'assignment' }], headers: {} });

    await expect(getCanvasQuizzes(42, 9)).rejects.toThrow(/page|pagination/i);
    expect(axiosRequest).toHaveBeenCalledTimes(1);
    config.canvasMaxPages = 4;
  });
});
