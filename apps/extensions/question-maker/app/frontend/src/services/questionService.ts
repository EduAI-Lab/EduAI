/**
 * Question API client handling CRUD, AI generation/extraction, variant ops, and ordering.
 * Provides typed responses to keep UI code lean and focused on rendering.
 */
import api from './api';
import {
  Question,
  QuestionCreate,
  QuestionMetadata,
  QuestionGenerationParams,
  QuestionStats,
  QuestionVariant,
  QuestionDifficulty,
  ReasoningLevel,
  ExtractedQuestion,
  MCQChoice
} from '../types/question';

/** Normalizes backend variant payload into frontend QuestionVariant shape. */
const mapVariant = (variant: any): QuestionVariant => ({
  id: variant.id,
  questionText: variant.questionText,
  difficulty: variant.difficulty ?? 'medium',
  reasoningLevel: variant.reasoningLevel ?? variant.reasoning_level ?? undefined,
  answer: variant.answer ?? null,
  choices: Array.isArray(variant.choices) ? variant.choices : (variant.choices ? [variant.choices] : null),
  questionMetadataId: variant.questionMetadataId ?? variant.question_metadata_id ?? undefined,
  assessmentId: variant.assessmentId ?? null,
  secondaryTopicsId: Array.isArray(variant.secondaryTopicsId)
    ? variant.secondaryTopicsId
    : Array.isArray(variant.secondary_topics_id)
      ? variant.secondary_topics_id
      : [],
  referenceId: variant.referenceId ?? variant.reference_id ?? null,
  isAiGenerated: variant.isAiGenerated ?? variant.is_ai_generated ?? false,
  isDraft: variant.isDraft ?? variant.is_draft ?? false,
  coreQuestionId: variant.coreQuestionId ?? variant.core_question_id ?? null,
  testable: variant.testable ?? undefined,
  createdAt: variant.createdAt ?? variant.created_at,
  updatedAt: variant.updatedAt ?? variant.updated_at,
  assessment: variant.assessment
    ? {
        id: variant.assessment.id,
        name: variant.assessment.name,
        type: variant.assessment.type,
        semester: variant.assessment.semester,
        createdAt: variant.assessment.createdAt ?? '',
        updatedAt: variant.assessment.updatedAt ?? ''
      }
    : undefined
});

/** Normalizes backend question payload into frontend Question shape. */
const mapQuestion = (item: any): Question => ({
  id: item.id,
  description: item.description ?? null,
  type: item.type,
  courseId: item.courseId,
  primaryTopicId: item.primaryTopicId,
  questionOrder: item.questionOrder ?? null,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
  course: item.course
    ? {
        id: item.course.id,
        name: item.course.name,
        code: item.course.code
      }
    : undefined,
  variants: Array.isArray(item.variants) ? item.variants.map(mapVariant) : []
});

export type PaginatedList<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

const PAGE_FETCH_SIZE = 100;
/** Server list endpoints clamp to this; larger explicit limits must page-loop. */
const SERVER_MAX_LIST_LIMIT = 200;
/** Hard ceiling so a bad `total` cannot spin forever. */
const MAX_FETCH_ALL = 10_000;

/** Unwraps list API payload — supports envelope `{ items, total, ... }` and legacy arrays. */
function unwrapPaginatedList<T>(data: unknown, mapItem: (row: any) => T): PaginatedList<T> {
  if (Array.isArray(data)) {
    const items = data.map(mapItem);
    return { items, total: items.length, limit: items.length, offset: 0 };
  }
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
    const page = data as { items: any[]; total?: number; limit?: number; offset?: number };
    const items = page.items.map(mapItem);
    return {
      items,
      total: typeof page.total === 'number' ? page.total : items.length,
      limit: typeof page.limit === 'number' ? page.limit : items.length,
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

  // The hard safety ceiling itself must never truncate silently — that's the exact bug
  // this PR fixes for the server's 50-row cap. If a caller asked for fewer than
  // MAX_FETCH_ALL explicitly, getting exactly that many back is expected, not a truncation.
  if (maxItems === MAX_FETCH_ALL && all.length >= MAX_FETCH_ALL && all.length < total) {
    throw new Error(
      `Result set has ${total} rows, exceeding the ${MAX_FETCH_ALL}-row fetch-all safety cap. ` +
        'Use getQuestionsPage() with explicit pagination instead of fetching all rows.',
    );
  }

  return all.slice(0, maxItems);
}

export const questionService = {
  /** Fetches one page of questions with pagination metadata (#1040). */
  async getQuestionsPage(options: {
    courseId?: number;
    questionBankId?: string;
    search?: string;
    types?: string[];
    difficulties?: string[];
    reasoningLevels?: string[];
    aiGenerated?: 'all' | 'ai' | 'not-ai';
    draftStatus?: 'all' | 'draft' | 'reviewed';
    sortBy?: 'newest' | 'oldest' | 'type';
    limit?: number;
    offset?: number;
  } = {}): Promise<PaginatedList<Question>> {
    const params: Record<string, unknown> = {};
    if (options.courseId !== undefined) params.courseId = options.courseId;
    if (options.questionBankId !== undefined) params.questionBankId = options.questionBankId;
    if (options.search !== undefined) params.search = options.search;
    if (options.types?.length) params.types = options.types.join(',');
    if (options.difficulties?.length) params.difficulties = options.difficulties.join(',');
    if (options.reasoningLevels?.length) {
      params.reasoningLevels = options.reasoningLevels.join(',');
    }
    if (options.aiGenerated && options.aiGenerated !== 'all') {
      params.aiGenerated = options.aiGenerated;
    }
    if (options.draftStatus && options.draftStatus !== 'all') {
      params.draftStatus = options.draftStatus;
    }
    if (options.sortBy && options.sortBy !== 'newest') params.sortBy = options.sortBy;
    if (options.limit !== undefined) params.limit = options.limit;
    if (options.offset !== undefined) params.offset = options.offset;

    const response = await api.get('/api/questions', { params });
    return unwrapPaginatedList(response.data.data, mapQuestion);
  },

  /**
   * Fetches questions for UI consumers.
   * - With an explicit `limit` ≤ server max: returns that single page's items.
   * - With a larger `limit`, or no limit: page-loops until all matching rows (or the
   *   requested cap) are loaded — fixes silent 50-cap and avoids silent clamp at 200.
   */
  async getQuestions(options: {
    courseId?: number;
    questionBankId?: string;
    search?: string;
    types?: string[];
    difficulties?: string[];
    reasoningLevels?: string[];
    aiGenerated?: 'all' | 'ai' | 'not-ai';
    draftStatus?: 'all' | 'draft' | 'reviewed';
    sortBy?: 'newest' | 'oldest' | 'type';
    limit?: number;
    offset?: number;
  } = {}): Promise<Question[]> {
    if (
      options.limit !== undefined &&
      options.limit > 0 &&
      options.limit <= SERVER_MAX_LIST_LIMIT
    ) {
      const page = await this.getQuestionsPage(options);
      return page.items;
    }

    const {
      limit: _ignoredLimit,
      offset: startOffset,
      ...filterOptions
    } = options;

    return fetchAllPages(
      (offset, limit) =>
        this.getQuestionsPage({
          ...filterOptions,
          limit,
          offset,
        }),
      {
        startOffset: startOffset ?? 0,
        maxItems: options.limit,
      },
    );
  },

  /** Retrieves a single question by ID. */
  async getQuestion(id: number): Promise<Question> {
    const response = await api.get(`/api/questions/${id}`);
    return mapQuestion(response.data.data);
  },

  /** Creates a question and returns the normalized result. */
  async createQuestion(question: QuestionCreate): Promise<Question> {
    const response = await api.post('/api/questions', question);
    return mapQuestion(response.data.data);
  },

  /** Updates question metadata. */
  async updateQuestion(id: number, question: Partial<QuestionCreate>): Promise<Question> {
    const response = await api.put(`/api/questions/${id}`, question);
    return mapQuestion(response.data.data);
  },

  /** Deletes a question. */
  async deleteQuestion(id: number): Promise<void> {
    await api.delete(`/api/questions/${id}`);
  },

  /** Creates a variant for a question and returns normalized data. */
  async createVariant(questionId: number, payload: {
    questionText: string;
    difficulty?: QuestionDifficulty;
    reasoningLevel?: 'factual' | 'analytical' | 'application';
    assessmentId?: number;
    secondaryTopicsId?: string[];
    answer?: string | null;
    choices?: MCQChoice[] | null;
    referenceId?: number;
    isAiGenerated?: boolean;
    isDraft?: boolean;
  }): Promise<QuestionVariant> {
    const response = await api.post(`/api/questions/${questionId}/variants`, payload);
    return mapVariant(response.data.data);
  },

  /** Updates a variant by ID. */
  async updateVariant(variantId: number, payload: {
    questionText?: string;
    difficulty?: QuestionDifficulty;
    reasoningLevel?: ReasoningLevel;
    assessmentId?: number;
    secondaryTopicsId?: string[];
    answer?: string | null;
    choices?: MCQChoice[] | null;
    referenceId?: number;
    isAiGenerated?: boolean;
    isDraft?: boolean;
  }): Promise<QuestionVariant> {
    const response = await api.put(`/api/questions/variants/${variantId}`, payload);
    return mapVariant(response.data.data);
  },

  /** Deletes a variant by ID. */
  async deleteVariant(variantId: number): Promise<void> {
    await api.delete(`/api/questions/variants/${variantId}`);
  },

  /** Toggles Core testable flag for a variant pushed to Core (AI Tutor integration). */
  async setVariantTestable(
    variantId: number,
    testable: boolean,
  ): Promise<{ id: string; testable: boolean }> {
    const response = await api.patch(`/api/questions/variants/${variantId}/testable`, {
      testable,
    });
    return response.data.data;
  },

  /** Calls legacy AI generate endpoint to produce draft question metadata. */
  async generateQuestions(params: QuestionGenerationParams): Promise<QuestionMetadata[]> {
    const response = await api.post('/api/questions/generate', params);
    return response.data.data;
  },

  /** Approves generated questions and saves them to the question bank. */
  async approveQuestions(questions: QuestionMetadata[], courseId?: number): Promise<Question[]> {
    const response = await api.post('/api/questions/approve', { questions, courseId });
    return (response.data.data || []).map(mapQuestion);
  },

  /** Returns aggregate question/variant stats for the current user (optional course scope). */
  async getQuestionStats(options: { courseId?: number } = {}): Promise<QuestionStats & {
    totalVariants?: number;
    typeStats?: Array<{ type: string; count: number | string }>;
    aiCount?: number;
    humanCount?: number;
    reviewedCount?: number;
    usedTopicIds?: string[];
  }> {
    const params: Record<string, unknown> = {};
    if (options.courseId !== undefined) params.courseId = options.courseId;
    const response = await api.get('/api/questions/stats', { params });
    return response.data.data;
  },

  /** Extracts questions from OCR text via backend AI service. */
  async extractQuestionsFromText(payload: { text: string; courseId: number; model?: string; apiKeys?: Record<string, any> }): Promise<ExtractedQuestion[]> {
    const response = await api.post('/api/questions/extract', payload);
    return response.data.data || [];
  },

  /** Saves extracted questions (and optional assessment) and returns normalized questions. */
  async saveExtractedQuestions(payload: {
    courseId: number;
    primaryTopicId?: string;
    topicName?: string;
    questions: ExtractedQuestion[];
    assessment?: {
      type: string;
      name: string;
    };
  }): Promise<{ questions: Question[]; assessmentId: number | null }> {
    const response = await api.post('/api/questions/extract/save', payload);
    const data = response.data.data;
    return {
      questions: (data.questions || []).map(mapQuestion),
      assessmentId: data.assessmentId || null
    };
  }
};
