/**
 * Client for assessment CRUD, section management, and variant linkage calls to the backend API.
 * Shapes payloads (e.g., blueprintConfig) and returns typed responses for UI consumers.
 */
import api from './api';
import {
  Assessment,
  AssessmentGenerationParams,
  AssessmentBlueprintConfig,
  AssessmentSection,
  AssessmentSectionCreateInput,
  SectionVariantLink
} from '../types/question';

type GetAssessmentsOptions = {
  courseId?: number;
  limit?: number;
  offset?: number;
};

export type PaginatedList<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

const PAGE_FETCH_SIZE = 100;
const SERVER_MAX_LIST_LIMIT = 200;
const MAX_FETCH_ALL = 10_000;

/** Unwraps list API payload — supports envelope `{ items, total, ... }` and legacy arrays. */
function unwrapPaginatedList<T>(data: unknown): PaginatedList<T> {
  if (Array.isArray(data)) {
    return {
      items: data as T[],
      total: data.length,
      limit: data.length,
      offset: 0,
    };
  }
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
    const page = data as PaginatedList<T>;
    return {
      items: page.items,
      total: typeof page.total === 'number' ? page.total : page.items.length,
      limit: typeof page.limit === 'number' ? page.limit : page.items.length,
      offset: typeof page.offset === 'number' ? page.offset : 0,
    };
  }
  return { items: [], total: 0, limit: 50, offset: 0 };
}

async function fetchAllPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<PaginatedList<T>>,
  options: { startOffset?: number; maxItems?: number } = {},
): Promise<T[]> {
  const all: T[] = [];
  let offset = options.startOffset ?? 0;
  let total = Infinity;
  const maxItems = Math.min(options.maxItems ?? MAX_FETCH_ALL, MAX_FETCH_ALL);

  while (all.length < total && all.length < maxItems) {
    const page = await fetchPage(offset, PAGE_FETCH_SIZE);
    all.push(...page.items);
    total = Number.isFinite(page.total) ? page.total : all.length;
    if (page.items.length === 0) break;
    offset += page.items.length;
    if (offset >= total) break;
  }
  return all.slice(0, maxItems);
}

const toBlueprintConfig = (payload: AssessmentGenerationParams): AssessmentBlueprintConfig => ({
  primaryTopicIds: payload.primaryTopicIds,
  secondaryTopicIds: payload.secondaryTopicIds,
  excludedTopicIds: payload.excludedTopicIds,
  difficultyDistribution: payload.difficultyDistribution,
  reasoningDistribution: payload.reasoningDistribution,
  reasoningData: payload.reasoningData
});

export const assessmentService = {
  /** Fetches one page of assessments with pagination metadata (#1040). */
  async getAssessmentsPage(options: GetAssessmentsOptions = {}): Promise<PaginatedList<Assessment>> {
    const params: Record<string, number> = {};
    if (options.courseId !== undefined) params.courseId = options.courseId;
    if (options.limit !== undefined) params.limit = options.limit;
    if (options.offset !== undefined) params.offset = options.offset;

    const response = await api.get('/api/assessments', {
      params: Object.keys(params).length ? params : undefined
    });
    return unwrapPaginatedList<Assessment>(response.data.data);
  },

  /**
   * Fetches assessments for UI consumers.
   * - With an explicit `limit` ≤ server max: returns that single page's items.
   * - With a larger `limit`, or no limit: page-loops until all matching rows are loaded.
   */
  async getAssessments(options: GetAssessmentsOptions = {}): Promise<Assessment[]> {
    if (
      options.limit !== undefined &&
      options.limit > 0 &&
      options.limit <= SERVER_MAX_LIST_LIMIT
    ) {
      const page = await this.getAssessmentsPage(options);
      return page.items;
    }

    return fetchAllPages(
      (offset, limit) =>
        this.getAssessmentsPage({
          courseId: options.courseId,
          limit,
          offset,
        }),
      {
        startOffset: options.offset ?? 0,
        maxItems: options.limit,
      },
    );
  },

  /** Creates an empty "Practice Exam" assessment for a course (e.g. sandbox or new course). */
  async createPracticeExamForCourse(courseId: number): Promise<Assessment> {
    const payload: AssessmentGenerationParams = {
      courseId,
      name: 'Practice Exam',
      type: 'Quiz',
      description: '',
      primaryTopicIds: [],
      secondaryTopicIds: [],
      excludedTopicIds: [],
      difficultyDistribution: { easy: 0, medium: 0, hard: 0 },
      reasoningDistribution: { factual: 0, analytical: 0, application: 0 },
      reasoningData: {
        factual: { total: 0, easyBoundary: 0, hardBoundary: 0 },
        analytical: { total: 0, easyBoundary: 0, hardBoundary: 0 },
        application: { total: 0, easyBoundary: 0, hardBoundary: 0 }
      }
    };
    return this.createAssessment(payload);
  },

  /** Creates an assessment with blueprint configuration derived from generation params. */
  async createAssessment(payload: AssessmentGenerationParams): Promise<Assessment> {
    const response = await api.post('/api/assessments', {
      type: payload.type,
      name: payload.name,
      description: payload.description,
      courseId: payload.courseId,
      blueprintConfig: toBlueprintConfig(payload)
    });

    return response.data.data;
  },

  /** Updates an existing assessment’s metadata and blueprint configuration. */
  async updateAssessment(assessmentId: number, payload: AssessmentGenerationParams): Promise<Assessment> {
    const response = await api.put(`/api/assessments/${assessmentId}`, {
      type: payload.type,
      name: payload.name,
      description: payload.description,
      courseId: payload.courseId,
      blueprintConfig: toBlueprintConfig(payload)
    });

    return response.data.data;
  },

  /** Retrieves a single assessment by ID. */
  async getAssessment(id: number): Promise<Assessment> {
    const response = await api.get(`/api/assessments/${id}`);
    return response.data.data;
  },

  /** Lists sections for an assessment. */
  async getAssessmentSections(assessmentId: number): Promise<AssessmentSection[]> {
    const response = await api.get(`/api/assessments/${assessmentId}/sections`);
    return response.data.data || [];
  },

  /** Creates a new section under an assessment. */
  async createSection(assessmentId: number, payload: AssessmentSectionCreateInput): Promise<AssessmentSection> {
    const response = await api.post(`/api/assessments/${assessmentId}/sections`, payload);
    return response.data.data;
  },

  /** Updates an existing section. */
  async updateSection(
    assessmentId: number,
    sectionId: number,
    payload: Partial<AssessmentSectionCreateInput>
  ): Promise<AssessmentSection> {
    const response = await api.put(`/api/assessments/${assessmentId}/sections/${sectionId}`, payload);
    return response.data.data;
  },

  /** Deletes a section from an assessment. */
  async deleteSection(assessmentId: number, sectionId: number): Promise<void> {
    await api.delete(`/api/assessments/${assessmentId}/sections/${sectionId}`);
  },

  /** Deletes an assessment. */
  async deleteAssessment(assessmentId: number): Promise<void> {
    await api.delete(`/api/assessments/${assessmentId}`);
  },

  /** Adds a variant to a section with optional display order/metadata. */
  async addVariantToSection(
    assessmentId: number,
    sectionId: number,
    payload: { variantId: number; displayOrder?: number; metadata?: Record<string, unknown> }
  ): Promise<SectionVariantLink> {
    const response = await api.post(
      `/api/assessments/${assessmentId}/sections/${sectionId}/variants`,
      payload
    );
    return response.data.data;
  },

  /** Removes a variant from a section. */
  async removeVariantFromSection(
    assessmentId: number,
    sectionId: number,
    variantId: number
  ): Promise<void> {
    await api.delete(
      `/api/assessments/${assessmentId}/sections/${sectionId}/variants/${variantId}`
    );
  },

  /** Removes a question from an assessment entirely. */
  async removeQuestionFromAssessment(assessmentId: number, questionId: number): Promise<void> {
    await api.delete(`/api/assessments/${assessmentId}/questions/${questionId}`);
  },

  async checkQuestionInAssessments(questionId: number): Promise<{ isInAssessments: boolean; assessmentIds: number[] }> {
    const response = await api.get(`/api/assessments/questions/${questionId}/check-in-assessments`);
    return response.data.data;
  },

  async removeQuestionFromAllSections(questionId: number): Promise<{ removedLinks: number; affectedAssessments: number[] }> {
    const response = await api.delete(`/api/assessments/questions/${questionId}/remove-from-all-sections`);
    return response.data.data;
  }
};

export default assessmentService;
