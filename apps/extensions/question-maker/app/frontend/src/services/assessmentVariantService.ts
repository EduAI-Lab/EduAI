/**
 * API client for the assessment variant workflow (reference exams, assembly, AI review).
 * Routes: `/api/assessment-variant`.
 */
import api from './api';
import { apiKeyStorage } from './apiKeyStorage';

export type StudyRole = 'reference_baseline' | 'generated_variant' | null;

export interface BlueprintSlot {
  order: number;
  variantId: number;
  questionMetadataId: number | null;
  questionType: string | null;
  primaryTopicId: number | null;
  difficulty: string;
  reasoningLevel?: string;
}

export interface BlueprintSnapshot {
  assessmentId: number;
  courseId: number | null;
  name: string;
  semester: string;
  type: string;
  studyRole: StudyRole;
  slotCount: number;
  slots: BlueprintSlot[];
  aggregates: {
    topicCounts: Record<string, number>;
    difficultyCounts: Record<string, number>;
    typeCounts: Record<string, number>;
    baseQuestionIds: number[];
  };
}

export interface AssembleVariantsResult {
  referenceAssessmentId: number;
  courseId: number;
  assemblyMode?: 'metadata_similarity';
  createdAssessments: Array<{ id: number; name: string; type: string; semester: string }>;
  assemblyTimeMs: number;
  warnings: Array<{ slot: number; questionMetadataId: number; message: string }>;
  slotsProcessed: number;
  examCount: number;
}

export interface GenerateBankVariantsResult {
  results: Array<{ questionId: number; promotedVariantId: number; createdVariantIds: number[] }>;
  errors: Array<{ questionId: number; iteration?: number; error: string }>;
  courseId: number;
}

export interface VariantReadinessSlot {
  order: number;
  questionMetadataId: number;
  description: string | null;
  questionType: string | null;
  nonDraftVariantCount: number;
  ready: boolean;
}

export interface BaselineVariantReadiness {
  assessmentId: number;
  courseId: number | null;
  minRequiredNonDraft: number;
  slots: VariantReadinessSlot[];
  allReady: boolean;
}

export interface VariantAiReviewRow {
  slot: number;
  baselineVariantId: number;
  variantVariantId: number;
  conceptual_equivalence: number | null;
  difficulty_similarity: number | null;
  structural_validity: number | null;
  answer_correctness: number | null;
  topic_alignment: number | null;
  distinctness?: number | null;
  exam_variant_composite_score_1to5: number | null;
  exam_variant_composite_score_0to100: number | null;
  exam_variant_composite_score_1to5_usability_adjusted: number | null;
  exam_variant_composite_score_0to100_usability_adjusted: number | null;
  exam_variant_distinctness_factor?: number | null;
  usability: 'usable_as_is' | 'usable_with_edits' | 'unusable';
  brief_reason: string;
}

export interface VariantAiReviewResult {
  baselineAssessmentId: number;
  variantAssessmentId: number;
  courseId: number;
  model: string;
  rubricUsed: string;
  reviewTimeMs: number;
  comparedSlots: number;
  baselineSlotCount: number;
  variantSlotCount: number;
  averages: Record<string, number | null>;
  usabilityCounts: {
    usable_as_is: number;
    usable_with_edits: number;
    unusable: number;
  };
  usableQuestionPercentage: number;
  compositeWeights: Record<string, number>;
  usabilityMultiplier: Record<string, number>;
  usabilityPenaltyApplied: boolean;
  examVariantScoreBase1to5: number | null;
  examVariantScoreBase0to100: number | null;
  examVariantScoreFinal1to5: number | null;
  examVariantScoreFinal0to100: number | null;
  distinctnessAverage1to5?: number | null;
  distinctnessFactorAvg?: number;
  distinctnessToFactor?: Record<string, number>;
  usabilityFactorAvg?: number;
  totalScoreCalculationSummary?: string | null;
  overallSummary: {
    summaryText: string;
    strengths: string[];
    weaknesses: string[];
  };
  perQuestion: VariantAiReviewRow[];
}

const apiBase = '/api/assessment-variant';

export const assessmentVariantService = {
  async setStudyRole(assessmentId: number, studyRole: StudyRole): Promise<{ blueprintConfig?: unknown }> {
    const response = await api.patch(`${apiBase}/assessments/${assessmentId}/role`, { studyRole });
    return response.data.data;
  },

  async getBlueprintSnapshot(assessmentId: number): Promise<BlueprintSnapshot> {
    const response = await api.get(`${apiBase}/assessments/${assessmentId}/blueprint-snapshot`);
    return response.data.data;
  },

  async getBaselineVariantReadiness(assessmentId: number, courseId: number): Promise<BaselineVariantReadiness> {
    const response = await api.get(
      `${apiBase}/assessments/${assessmentId}/variant-readiness`,
      { params: { courseId } }
    );
    return response.data.data;
  },

  async assembleEquivalentExams(payload: {
    referenceAssessmentId: number;
    courseId: number;
    examLabels?: string[];
    namePrefix?: string;
    includeDrafts?: boolean;
    semesterOverride?: string;
    assessmentTypeOverride?: string;
  }): Promise<AssembleVariantsResult> {
    const response = await api.post(`${apiBase}/assemble-variants`, payload);
    return response.data.data;
  },

  /** Parallel exams: each baseline slot matched to the best bank question by topic/type/difficulty/reasoning score. */
  async assembleExamsByMetadataSimilarity(payload: {
    referenceAssessmentId: number;
    courseId: number;
    examLabels?: string[];
    namePrefix?: string;
    includeDrafts?: boolean;
    semesterOverride?: string;
    assessmentTypeOverride?: string;
  }): Promise<AssembleVariantsResult> {
    const response = await api.post(`${apiBase}/assemble-by-metadata`, payload);
    return response.data.data;
  },

  /** After bank OCR save: promote each primary variant and generate N alternate variants via EduAI. */
  async generateBankVariants(payload: {
    courseId: number;
    questionIds: number[];
    model?: string;
    variantsToAdd?: number;
    variantPromptInstructions?: string | null;
  }): Promise<GenerateBankVariantsResult> {
    const model = payload.model ?? 'ollama:gpt-oss:120b';
    const apiKeys = await apiKeyStorage.buildApiKeysForModel(model);
    const response = await api.post(`${apiBase}/generate-bank-variants`, {
      ...payload,
      model,
      apiKeys
    });
    return response.data.data;
  },

  async reviewVariantWithAi(payload: {
    baselineAssessmentId: number;
    variantAssessmentId: number;
    courseId: number;
    model?: string;
    rubricText?: string;
  }): Promise<VariantAiReviewResult> {
    const model = payload.model ?? 'ollama:gpt-oss:120b';
    const apiKeys = await apiKeyStorage.buildApiKeysForModel(model);
    const response = await api.post(`${apiBase}/review-variant-ai`, {
      ...payload,
      model,
      apiKeys
    });
    return response.data.data;
  }
};

export default assessmentVariantService;
