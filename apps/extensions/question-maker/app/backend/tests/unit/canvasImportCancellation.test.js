/** Import must not report partial success after a caller abort/deadline. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosRequest = vi.fn();
const integrationFindOne = vi.fn();
const courseFindOne = vi.fn();
const questionMetadataCreate = vi.fn();
const variantsCreate = vi.fn();
const sectionVariantsCreate = vi.fn();
const mappingFindOne = vi.fn();
const mappingCreate = vi.fn();

vi.mock('axios', () => ({ default: axiosRequest }));
vi.mock('../../src/services/assessmentService.js', () => ({
  getAssessmentById: vi.fn(),
  createAssessment: vi.fn().mockResolvedValue({ id: 700, name: 'Imported quiz' }),
}));
vi.mock('../../src/services/assessmentSectionService.js', () => ({
  createAssessmentSection: vi.fn().mockResolvedValue({ id: 701 }),
}));
vi.mock('../../src/config/database.js', () => ({
  prisma: {
    canvasIntegration: { findUnique: integrationFindOne },
    course: { findFirst: courseFindOne },
    questionMetadata: { create: questionMetadataCreate },
    variants: { create: variantsCreate },
    sectionVariants: { create: sectionVariantsCreate },
    canvasCourseMapping: { findUnique: mappingFindOne, create: mappingCreate },
    assessmentSections: {},
  },
}));
vi.mock('../../src/config/settings.js', () => ({
  config: {
    canvasRequestTimeoutMs: 1_000,
    canvasOperationTimeoutMs: 10_000,
    canvasMaxCompressedResponseBytes: 64 * 1024,
    canvasMaxResponseBytes: 64 * 1024,
    canvasMaxRequestBodyBytes: 64 * 1024,
    canvasMaxPages: 4,
    canvasMaxItems: 8,
  },
  default: {},
}));

const { importQuizFromCanvas } = await import('../../src/services/canvasService.js');

beforeEach(() => {
  vi.clearAllMocks();
  axiosRequest.mockReset();
  integrationFindOne.mockResolvedValue({
    isTestMode: false,
    canvasUrl: 'https://canvas.example.edu',
    apiKey: 'secret-token',
  });
  courseFindOne.mockResolvedValue({ id: 9 });
  questionMetadataCreate.mockResolvedValue({ id: 800 });
  variantsCreate.mockResolvedValue({ id: 801 });
  sectionVariantsCreate.mockResolvedValue({ id: 802 });
  mappingFindOne.mockResolvedValue(null);
});

describe('importQuizFromCanvas cancellation', () => {
  it('fails the whole import after a detail abort instead of returning one persisted question', async () => {
    const controller = new AbortController();
    let detailSignal;
    axiosRequest.mockImplementation((request) => {
      const url = request.url || '';
      if (url.endsWith('/quizzes/1')) return Promise.resolve({ data: { id: 1, title: 'Imported quiz' } });
      if (url.endsWith('/questions')) {
        return Promise.resolve({
          data: [
            {
              id: null,
              question_name: '1. First question',
              question_text: 'What is 2+2?',
              question_type: 'short_answer_question',
              answers: [{ answer_text: '4', answer_weight: 100 }],
            },
            { id: 2, question_name: '2. Pending question', question_type: 'short_answer_question' },
          ],
        });
      }
      if (url.endsWith('/questions/2')) {
        detailSignal = request.signal;
        return new Promise((_, reject) => {
          request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
        });
      }
      throw new Error(`unexpected Canvas request: ${url}`);
    });

    const pending = importQuizFromCanvas(
      'user-1',
      9,
      1,
      9,
      { primaryTopicId: 'topic-1' },
      'owner-1',
      { signal: controller.signal },
    );
    // Allow quiz/list/detail calls to reach the pending adapter.
    await vi.waitFor(() => expect(detailSignal).toBeDefined());
    controller.abort(new DOMException('client disconnected', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    // The first item may already have been persisted, but no post-abort item
    // or final mapping may be written and no second detail request is made.
    expect(questionMetadataCreate).toHaveBeenCalledTimes(1);
    expect(mappingCreate).not.toHaveBeenCalled();
    expect(axiosRequest).toHaveBeenCalledTimes(3);
  });

  it('imports every paginated question page and reports the complete count', async () => {
    axiosRequest.mockImplementation((request) => {
      const url = request.url || '';
      if (url.endsWith('/quizzes/1')) {
        return Promise.resolve({ data: { id: 1, title: 'Imported quiz' } });
      }
      if (/\/questions(?:\?|$)/.test(url)) {
        if (url.includes('page=2')) {
          return Promise.resolve({
            data: [{ id: 2, question_name: '2. Second', question_type: 'short_answer_question' }],
            headers: {},
          });
        }
        return Promise.resolve({
          data: [{ id: 1, question_name: '1. First', question_type: 'short_answer_question' }],
          headers: {
            link: '<https://canvas.example.edu/api/v1/courses/9/quizzes/1/questions?page=2>; rel="next"',
          },
        });
      }
      if (/\/questions\/[12]$/.test(url)) {
        const id = url.endsWith('/1') ? 1 : 2;
        return Promise.resolve({
          data: {
            id,
            question_name: `${id}. Detail`,
            question_text: `Question ${id}`,
            question_type: 'short_answer_question',
            answers: [{ answer_text: `Answer ${id}`, answer_weight: 100 }],
          },
        });
      }
      throw new Error(`unexpected Canvas request: ${url}`);
    });

    const result = await importQuizFromCanvas(
      'user-1',
      9,
      1,
      9,
      { primaryTopicId: 'topic-1' },
      'owner-1',
    );

    expect(result.questionsImported).toBe(2);
    expect(result.questionsSkipped).toBe(0);
    expect(questionMetadataCreate).toHaveBeenCalledTimes(2);
    // quiz detail + two list pages + two detail GETs
    expect(axiosRequest).toHaveBeenCalledTimes(5);
    expect(mappingCreate).toHaveBeenCalledTimes(1);
  });
});
