/**
 * Defense-in-depth SSRF guard test (#991): even an already-persisted Canvas
 * integration row (saved before the connect-time guard existed, or altered
 * directly in the DB) must not be used to make an outbound request to a
 * private/link-local/loopback target or a non-HTTPS URL.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosRequest = vi.fn();
const integrationFindOne = vi.fn();

vi.mock('axios', () => ({
  default: axiosRequest,
}));

vi.mock('../../src/services/assessmentService.js', () => ({
  getAssessmentById: vi.fn(),
  createAssessment: vi.fn(),
}));
vi.mock('../../src/services/questionService.js', () => ({ createQuestion: vi.fn() }));
vi.mock('../../src/services/assessmentSectionService.js', () => ({ createAssessmentSection: vi.fn() }));

vi.mock('../../src/schema/index.js', () => ({
  CanvasIntegration: { findOne: integrationFindOne },
  CanvasCourseMapping: { findOne: vi.fn(), create: vi.fn() },
  Question_Metadata: {},
  Variants: {},
  AssessmentSections: {},
  SectionVariants: {},
  Course: {},
}));

const { getCanvasCourses } = await import('../../src/services/canvasService.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('makeCanvasRequest — SSRF re-validation at request time (#991)', () => {
  it.each([
    ['cloud metadata IP', 'https://169.254.169.254'],
    ['loopback IP', 'https://127.0.0.1'],
    ['non-HTTPS scheme', 'http://canvas.example.com'],
  ])('rejects a stored canvasUrl targeting %s without calling axios', async (_label, canvasUrl) => {
    integrationFindOne.mockResolvedValue({
      isTestMode: false,
      canvasUrl,
      apiKey: 'secret-token',
    });

    await expect(getCanvasCourses(42)).rejects.toThrow();
    expect(axiosRequest).not.toHaveBeenCalled();
  });

  it('allows a valid stored https canvasUrl through to axios', async () => {
    integrationFindOne.mockResolvedValue({
      isTestMode: false,
      canvasUrl: 'https://canvas.example.edu',
      apiKey: 'secret-token',
    });
    axiosRequest.mockResolvedValue({ data: [] });

    await expect(getCanvasCourses(42)).resolves.toEqual([]);
    expect(axiosRequest).toHaveBeenCalled();
  });

  it('pins the DNS lookup and disables redirects, so a resolved/redirected private address cannot be reached', async () => {
    integrationFindOne.mockResolvedValue({
      isTestMode: false,
      canvasUrl: 'https://canvas.example.edu',
      apiKey: 'secret-token',
    });
    axiosRequest.mockResolvedValue({ data: [] });

    await getCanvasCourses(42);

    const requestConfig = axiosRequest.mock.calls[0][0];
    expect(requestConfig.maxRedirects).toBe(0);
    expect(typeof requestConfig.lookup).toBe('function');
  });
});
