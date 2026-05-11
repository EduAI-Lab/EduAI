/**
 * exportAssessmentToCanvas with mocked axios (Canvas API), schema models, and getAssessmentById.
 * No real HTTP or database.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const axiosRequest = jest.fn();
const getAssessmentById = jest.fn();
const integrationFindOne = jest.fn();
const mappingFindOne = jest.fn();
const mappingCreate = jest.fn();

await jest.unstable_mockModule('axios', () => ({
  default: axiosRequest,
}));

await jest.unstable_mockModule('../src/services/assessmentService.js', () => ({
  getAssessmentById,
  createAssessment: jest.fn(),
}));

await jest.unstable_mockModule('../src/services/questionService.js', () => ({
  createQuestion: jest.fn(),
}));

await jest.unstable_mockModule('../src/services/assessmentSectionService.js', () => ({
  createAssessmentSection: jest.fn(),
}));

await jest.unstable_mockModule('../src/schema/index.js', () => ({
  CanvasIntegration: { findOne: integrationFindOne },
  CanvasCourseMapping: { findOne: mappingFindOne, create: mappingCreate },
  Question_Metadata: {},
  Variants: {},
  AssessmentSections: {},
  SectionVariants: {},
  Course: {},
}));

const { exportAssessmentToCanvas } = await import('../src/services/canvasService.js');

const sampleAssessment = () => ({
  id: 100,
  name: 'Unit export quiz',
  description: 'From tests',
  type: 'midterm',
  courseId: 5,
  sections: [
    {
      name: 'A',
      sectionVariants: [
        {
          displayOrder: 0,
          variant: {
            questionText: 'Choose:\nA) one\nB) two',
            answer: 'A',
            questionMetadata: { type: 'MCQ', description: 'pick' },
            choices: [
              { letter: 'A', text: 'one' },
              { letter: 'B', text: 'two' },
            ],
          },
        },
      ],
    },
  ],
});

describe('exportAssessmentToCanvas (Canvas API mocked via axios)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    integrationFindOne.mockResolvedValue({
      isTestMode: false,
      canvasUrl: 'https://canvas.example.edu',
      apiKey: 'secret-token',
    });
    getAssessmentById.mockResolvedValue(sampleAssessment());
    mappingFindOne.mockResolvedValue(null);
    mappingCreate.mockResolvedValue({ id: 1 });

    axiosRequest.mockImplementation((config) => {
      const url = config.url || '';
      if (config.method === 'POST' && /\/courses\/\d+\/quizzes$/.test(url) && !/\/quizzes\/\d+\/questions/.test(url)) {
        return Promise.resolve({
          data: { id: 501, title: 'Unit export quiz' },
        });
      }
      if (config.method === 'POST' && /\/quizzes\/\d+\/questions/.test(url)) {
        return Promise.resolve({ data: { id: 9001, position: 1 } });
      }
      return Promise.resolve({ data: {} });
    });
  });

  it('POSTs quiz then questions to Canvas and saves course mapping', async () => {
    const result = await exportAssessmentToCanvas(42, 100, 999);

    expect(integrationFindOne).toHaveBeenCalledWith({ where: { userId: 42 } });
    expect(getAssessmentById).toHaveBeenCalledWith(100, 42);
    expect(axiosRequest).toHaveBeenCalled();
    const urls = axiosRequest.mock.calls.map((c) => c[0].url);
    expect(urls.some((u) => u.includes('/api/v1/courses/999/quizzes') && !u.includes('/questions'))).toBe(true);
    expect(urls.some((u) => u.includes('/courses/999/quizzes/501/questions'))).toBe(true);
    expect(result).toEqual({
      quizId: 501,
      quizTitle: 'Unit export quiz',
      questionsCreated: 1,
      canvasUrl: 'https://canvas.example.edu/courses/999/quizzes/501',
    });
    expect(mappingFindOne).toHaveBeenCalledWith({
      where: { userId: 42, localCourseId: 5 },
    });
    expect(mappingCreate).toHaveBeenCalledWith({
      userId: 42,
      localCourseId: 5,
      canvasCourseId: 999,
      canvasCourseName: undefined,
    });
  });

  it('throws when Canvas is not connected', async () => {
    integrationFindOne.mockResolvedValue(null);
    await expect(exportAssessmentToCanvas(1, 1, 1)).rejects.toThrow(/Canvas integration not configured/i);
    expect(axiosRequest).not.toHaveBeenCalled();
  });
});
