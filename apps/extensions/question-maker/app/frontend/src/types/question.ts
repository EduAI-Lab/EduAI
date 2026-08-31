/**
 * Core domain types for questions, variants, courses, topics, and assessments.
 */
import type { Topic } from "./topic";

export type { Topic } from "./topic";

// These three are Prisma `Json?` columns the frontend forwards verbatim: it
// never reads a field off them, so JSON's own contract is the whole contract.
import type { JsonObject } from "@eduai/types";

export type QuestionDifficulty = "easy" | "medium" | "hard";
export type QuestionType = "MCQ" | "SA" | "LA";
export type ReasoningLevel = "factual" | "analytical" | "application";

export const questionTypeLabels = {
  MCQ: "Multiple Choice",
  SA: "Short Answer",
  LA: "Long Answer",
} satisfies Record<QuestionType, string>;
export const assessmentTypes = ["Assignment", "Lab", "Quiz", "Midterm", "Final"] as const;
export type AssessmentType = (typeof assessmentTypes)[number];

// MCQ Choice interface
export interface MCQChoice {
  letter: string; // "A", "B", "C", "D", etc.
  text: string;
}

// Question Metadata (matches backend Question_Metadata schema)
export interface QuestionMetadata {
  id: number;
  description: string | null;
  type: QuestionType;
  courseId: number;
  primaryTopicId: string;
  questionOrder: Record<number, number> | null; // Maps assessment IDs to order numbers
  createdAt: string;
  updatedAt: string;
  // Relations
  course?: Course;
  primaryTopic?: Topic;
  variants?: QuestionVariant[];
}

// Question Variant (matches backend Variants schema)
export interface QuestionVariant {
  id: number;
  questionText: string;
  difficulty: QuestionDifficulty;
  reasoningLevel?: ReasoningLevel;
  questionMetadataId?: number;
  assessmentId: number | null;
  secondaryTopicsId: string[] | null;
  referenceId: number | null;
  answer: string | null;
  choices?: MCQChoice[] | null; // For MCQ questions only
  selectAllThatApply?: boolean;
  correctAnswers?: string[] | null;
  isAiGenerated?: boolean; // Indicates if this variant was generated using AI
  isDraft?: boolean; // Indicates if this variant is a draft and needs review
  /** Core Question CUID after approval push — required for AI Tutor testable toggle. */
  coreQuestionId?: string | null;
  /**
   * When true on Core, other EduAI extensions may use this question. QM mirrors
   * it locally as `shareWithExtensions`; `mapVariant` folds the two together.
   */
  testable?: boolean;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  // Relations
  questionMetadata?: QuestionMetadata;
  assessment?: Assessment;
  originalVariant?: QuestionVariant;
  referencedVariants?: QuestionVariant[];
}

// Assessment (matches backend Assessments schema)
export interface Assessment {
  id: number;
  type: AssessmentType;
  name: string;
  semester: string;
  courseId?: number | null;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
  blueprintConfig?: AssessmentBlueprintConfig | null;
  // Relations
  variants?: QuestionVariant[];
  sections?: AssessmentSection[];
  course?: Course;
}

// Course (matches backend Course schema)
export interface Course {
  id: number;
  name: string;
  code: string | null;
  description?: string | null;
  userId?: string;
  coreCourseId?: string | null;
  department?: string | null;
  accessLevel?: "admin" | "unit" | "instructor" | "ta" | null;
  term?: string | null;
  year?: number | null;
  /** Core's live publish state (display-only; null when Core unresolved). */
  isPublished?: boolean | null;
  createdAt?: string;
  updatedAt?: string;
  // Relations
  user?: User;
  topics?: Topic[];
  questionMetadata?: QuestionMetadata[];
}

export interface CourseCreate {
  /**
   * Core Course CUID — required at creation (#1072 §4 step 7: every QM course
   * originates in Core). `name`/`code` are Core-owned and never accepted here
   * (#1072 §4 step 10) — the anchor row has nothing else to send.
   */
  coreCourseId: string;
}

// Topic type exported from ./topic (CUID string ids)

// User (matches backend User schema)
export interface User {
  id: number;
  email: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
  // Relations
  courses?: Course[];
}

export interface Question extends QuestionMetadata {}

export interface QuestionCreate {
  description?: string | null;
  courseId: number;
  primaryTopicId: string;
  type: QuestionType;
  questionOrder?: Record<number, number> | null;
}

export interface QuestionGenerationParams {
  /** Required course context for the legacy generation endpoint. */
  courseId: number;
  prompt: string;
  provider: "groq" | "openai" | "deepseek";
  numQuestions: number;
  difficultyDistribution: {
    easy: number;
    medium: number;
    hard: number;
  };
  reasoningDistribution: {
    factual: number;
    analytical: number;
    application: number;
  };
}

export interface QuestionStats {
  totalQuestions: number;
  difficultyStats: Array<{
    difficulty: QuestionDifficulty;
    count: number;
  }>;
  bloomLevelStats: Array<{
    bloomLevel: string;
    count: number;
  }>;
}

export interface ExtractedQuestion {
  summary: string;
  question: string;
  instructions?: string;
  difficulty: QuestionDifficulty;
  answer: string | null;
  type: QuestionType;
  primaryTopicId: string | null;
  secondaryTopicIds: string[];
  /** MCQ options: only present for type === 'MCQ'. */
  choices?: MCQChoice[] | null;
  selectAllThatApply?: boolean;
  correctAnswers?: string[] | null;
}

export interface QuestionVariantEntry {
  questionId: number;
  questionDescription: string | null;
  questionType: QuestionType;
  primaryTopicId: string;
  primaryTopicName?: string;
  courseId: number;
  courseName?: string;
  courseCode?: string | null;
  secondaryTopicNames?: string[];
  isAiGenerated?: boolean;
  isDraft?: boolean;
  variant: QuestionVariant;
}

export type ReasoningProfile = {
  total: number;
  easyBoundary: number;
  hardBoundary: number;
};

export type ReasoningDataState = {
  factual: ReasoningProfile;
  analytical: ReasoningProfile;
  application: ReasoningProfile;
};

export interface AssessmentBlueprintConfig {
  primaryTopicIds: string[];
  secondaryTopicIds: string[];
  excludedTopicIds: string[];
  difficultyDistribution: {
    easy: number;
    medium: number;
    hard: number;
  };
  reasoningDistribution: {
    factual: number;
    analytical: number;
    application: number;
  };
  reasoningData: ReasoningDataState;
  /** Assessment variant workflow: imported reference vs. system-assembled variant exams */
  studyRole?: "reference_baseline" | "generated_variant";
  referenceAssessmentId?: number;
  variantLabel?: string;
  assembledAt?: string;
}

export interface AssessmentGenerationParams extends AssessmentBlueprintConfig {
  courseId: number;
  name: string;
  type: AssessmentType;
  description: string;
}

export interface SectionVariantLink {
  id: number;
  sectionId: number;
  variantId: number;
  displayOrder: number;
  metadata?: JsonObject | null;
  variant?: QuestionVariant;
}

export interface AssessmentSection {
  id: number;
  assessmentId: number;
  name: string;
  description?: string | null;
  sectionType?: string | null;
  difficultySettings?: JsonObject | null;
  topicFilters?: JsonObject | null;
  metadata?: JsonObject | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  sectionVariants?: SectionVariantLink[];
}

export interface AssessmentSectionCreateInput {
  name: string;
  description?: string;
  sectionType?: string;
  difficultySettings?: JsonObject | null;
  topicFilters?: JsonObject | null;
  metadata?: JsonObject | null;
  position?: number;
  questionTypes?: QuestionType[];
  reasoningData?: ReasoningDataState;
}
