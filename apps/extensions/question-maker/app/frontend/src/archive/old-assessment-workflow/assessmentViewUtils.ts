/**
 * Utility helpers for the assessment builder: topic normalization, filter construction, and draft helpers.
 * Keeps shared logic for section creation and question matching in one place.
 */
import {
  Assessment,
  AssessmentSection,
  AssessmentSectionCreateInput,
  Question,
  QuestionType,
  ReasoningDataState
} from '../../types/question';
import { QuestionSearchFilters, QUESTION_TYPES, defaultReasoningData } from '../../pages/assessments/assessmentViewTypes';

export const sanitizeTopicGroups = (
  primaryInput: number[],
  secondaryInput: number[],
  excludedInput: number[]
): { primary: number[]; secondary: number[]; excluded: number[] } => {
  const seen = new Set<number>();
  const sanitizeList = (values: number[]) => {
    const result: number[] = [];
    values.forEach((id) => {
      if (!seen.has(id)) {
        seen.add(id);
        result.push(id);
      }
    });
    return result;
  };

  return {
    primary: sanitizeList(primaryInput),
    secondary: sanitizeList(secondaryInput),
    excluded: sanitizeList(excludedInput)
  };
};

const toNumberArray = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
};

export const extractTopicFiltersFromSection = (
  section?: AssessmentSection | null
): {
  primaryTopicIds: number[];
  secondaryTopicIds: number[];
  excludedTopicIds: number[];
} => {
  if (!section?.topicFilters || typeof section.topicFilters !== 'object') {
    return { primaryTopicIds: [], secondaryTopicIds: [], excludedTopicIds: [] };
  }
  const filters = section.topicFilters as Record<string, unknown>;
  const resolve = (keys: string[]) => {
    for (const key of keys) {
      const value = filters[key];
      if (Array.isArray(value)) {
        return toNumberArray(value);
      }
    }
    return [];
  };
  return {
    primaryTopicIds: resolve(['primaryTopicIds', 'primary_topic_ids']),
    secondaryTopicIds: resolve(['secondaryTopicIds', 'secondary_topic_ids']),
    excludedTopicIds: resolve(['excludedTopicIds', 'excluded_topic_ids'])
  };
};

export const extractMetadataValue = <T,>(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
  fallback: T
): T => {
  if (!metadata || typeof metadata !== 'object') return fallback;
  const value = metadata[key];
  return (value as T) ?? fallback;
};

const normalizeQuestionTypes = (types: unknown): QuestionType[] => {
  if (!Array.isArray(types)) return [];
  return types
    .map((type) => (typeof type === 'string' ? type.trim().toUpperCase() : ''))
    .filter((type): type is QuestionType => QUESTION_TYPES.includes(type as QuestionType));
};

export const deriveQuestionTypesFromSection = (section?: AssessmentSection | null): QuestionType[] => {
  if (!section) return [];
  const metadataTypes = normalizeQuestionTypes((section.metadata as any)?.questionTypes);
  if (metadataTypes.length > 0) return metadataTypes;
  if (typeof section.sectionType === 'string') {
    const parsed = section.sectionType
      .split(',')
      .map((item) => item.trim().toUpperCase())
      .filter((item): item is QuestionType => QUESTION_TYPES.includes(item as QuestionType));
    if (parsed.length > 0) return parsed;
  }
  return [];
};

export const buildDraftFromSection = (
  section: AssessmentSection
): { filters: QuestionSearchFilters; payload: AssessmentSectionCreateInput } => {
  const topicFilters = extractTopicFiltersFromSection(section);
  const questionTypes: QuestionType[] = deriveQuestionTypesFromSection(section);
  const metadata = (section.metadata as Record<string, unknown>) || {};
  const selectedReasoningRaw = metadata.selectedReasoning;
  const selectedReasoning: Array<keyof ReasoningDataState> = Array.isArray(selectedReasoningRaw)
    ? selectedReasoningRaw.filter((r): r is keyof ReasoningDataState =>
        ['factual', 'analytical', 'application'].includes(r as string)
      )
    : selectedReasoningRaw && ['factual', 'analytical', 'application'].includes(selectedReasoningRaw as string)
    ? [selectedReasoningRaw as keyof ReasoningDataState]
    : [];

  const questionTarget =
    typeof metadata.questionTarget === 'number' ? metadata.questionTarget : 10;
  const reasoningData = (section as any).reasoningData ?? defaultReasoningData();
  const primaryReasoning = selectedReasoning.length > 0 ? selectedReasoning[0] : 'factual';
  const difficultySettings =
    section.difficultySettings ?? {
      easyBoundary: reasoningData[primaryReasoning].easyBoundary,
      hardBoundary: reasoningData[primaryReasoning].hardBoundary
    };

  const payload: AssessmentSectionCreateInput = {
    name: section.name,
    sectionType: questionTypes.join(', '),
    questionTypes,
    topicFilters,
    metadata: {
      ...metadata,
      questionTarget,
      selectedReasoning,
      questionTypes
    },
    reasoningData,
    difficultySettings
  };

  const difficultyRaw = metadata.difficulty;
  const difficulty: Array<'easy' | 'medium' | 'hard'> | null = Array.isArray(difficultyRaw)
    ? difficultyRaw.filter((d): d is 'easy' | 'medium' | 'hard' =>
        ['easy', 'medium', 'hard'].includes(d as string)
      )
    : difficultyRaw && ['easy', 'medium', 'hard'].includes(difficultyRaw as string)
    ? [difficultyRaw as 'easy' | 'medium' | 'hard']
    : null;

  const reasoningLevelRaw = metadata.reasoningLevel || metadata.selectedReasoning;
  const reasoningLevel: Array<'factual' | 'analytical' | 'application'> | null = Array.isArray(reasoningLevelRaw)
    ? reasoningLevelRaw.filter((r): r is 'factual' | 'analytical' | 'application' =>
        ['factual', 'analytical', 'application'].includes(r as string)
      )
    : reasoningLevelRaw && ['factual', 'analytical', 'application'].includes(reasoningLevelRaw as string)
    ? [reasoningLevelRaw as 'factual' | 'analytical' | 'application']
    : null;

  const filters: QuestionSearchFilters = {
    questionTypes,
    primaryTopicIds: topicFilters.primaryTopicIds,
    secondaryTopicIds: topicFilters.secondaryTopicIds,
    excludedTopicIds: topicFilters.excludedTopicIds,
    difficulty,
    reasoningLevel
  };

  return { filters, payload };
};

/** Minimal section draft so "Save to Section" is enabled with only questions selected (no filters required). */
export const getDefaultSectionDraft = (): AssessmentSectionCreateInput => {
  const reasoningData = defaultReasoningData();
  return {
    name: '',
    sectionType: '',
    questionTypes: [],
    topicFilters: {
      primaryTopicIds: [],
      secondaryTopicIds: [],
      excludedTopicIds: []
    },
    metadata: {},
    reasoningData,
    difficultySettings: {
      easyBoundary: reasoningData.factual.easyBoundary,
      hardBoundary: reasoningData.factual.hardBoundary
    }
  };
};

const collectSecondaryTopicIds = (question: Question): number[] => {
  return Array.from(
    new Set(
      (question.variants ?? []).flatMap((variant) => variant.secondaryTopicsId ?? [])
    )
  ).filter((id): id is number => typeof id === 'number');
};

export const questionMatchesFilters = (question: Question, filters: QuestionSearchFilters): boolean => {
  const matchesType =
    filters.questionTypes.length === 0 || filters.questionTypes.includes(question.type);

  const secondaryIds = collectSecondaryTopicIds(question);
  const hasPrimaryMatch =
    filters.primaryTopicIds.length === 0
      ? false
      : filters.primaryTopicIds.includes(question.primaryTopicId);
  const hasSecondaryMatch =
    filters.secondaryTopicIds.length === 0
      ? false
      : secondaryIds.some((id) => filters.secondaryTopicIds.includes(id));

  const matchesTopic =
    filters.primaryTopicIds.length === 0 && filters.secondaryTopicIds.length === 0
      ? true
      : hasPrimaryMatch || hasSecondaryMatch;

  const isExcluded =
    filters.excludedTopicIds.includes(question.primaryTopicId) ||
    secondaryIds.some((topicId) => filters.excludedTopicIds.includes(topicId));

  // Filter by difficulty if specified
  const matchesDifficulty =
    !filters.difficulty || filters.difficulty.length === 0 ||
    (question.variants ?? []).some((variant) =>
      filters.difficulty!.includes(variant.difficulty)
    );

  // Filter by reasoning level if specified
  const matchesReasoningLevel =
    !filters.reasoningLevel || filters.reasoningLevel.length === 0 ||
    (question.variants ?? []).some((variant) =>
      variant.reasoningLevel && filters.reasoningLevel!.includes(variant.reasoningLevel)
    );

  return matchesType && matchesTopic && !isExcluded && matchesDifficulty && matchesReasoningLevel;
};
