/**
 * Core domain types for questions, variants, courses, topics, and assessments.
 */
export type QuestionDifficulty = 'easy' | 'medium' | 'hard';
export type QuestionType = 'MCQ' | 'SA' | 'LA';
export type ReasoningLevel = 'factual' | 'analytical' | 'application';

export const questionTypeLabels: Record<QuestionType, string> = {
    MCQ: 'Multiple Choice',
    SA: 'Short Answer',
    LA: 'Long Answer'
};
export type AssessmentType = 'Assignment' | 'Lab' | 'Quiz' | 'Mid' | 'Final';

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
    primaryTopicId: number;
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
    secondaryTopicsId: number[] | null;
    referenceId: number | null;
    answer: string | null;
    choices?: MCQChoice[] | null; // For MCQ questions only
    isAiGenerated?: boolean; // Indicates if this variant was generated using AI
    isDraft?: boolean; // Indicates if this variant is a draft and needs review
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
    userId?: number;
    createdAt?: string;
    updatedAt?: string;
    // Relations
    user?: User;
    topics?: Topic[];
    questionMetadata?: QuestionMetadata[];
}

export interface CourseCreate {
    name: string;
    courseCode?: string;
}

// Topic (matches backend Topics schema)
export interface Topic {
    id: number;
    name: string;
    courseId: number;
    createdAt: string;
    updatedAt: string;
    // Relations
    course?: Course;
    primaryQuestions?: QuestionMetadata[];
}

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
    primaryTopicId: number;
    type: QuestionType;
    questionOrder?: Record<number, number> | null;
}

export interface QuestionGenerationParams {
    prompt: string;
    provider: 'groq' | 'openai' | 'deepseek';
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
    primaryTopicId: number | null;
    secondaryTopicIds: number[];
    /** MCQ options: only present for type === 'MCQ'. */
    choices?: MCQChoice[] | null;
}

export interface QuestionVariantEntry {
    questionId: number;
    questionDescription: string | null;
    questionType: QuestionType;
    primaryTopicId: number;
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
    primaryTopicIds: number[];
    secondaryTopicIds: number[];
    excludedTopicIds: number[];
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
    studyRole?: 'reference_baseline' | 'generated_variant';
    referenceAssessmentId?: number;
    variantLabel?: string;
    assembledAt?: string;
}

export interface AssessmentGenerationParams extends AssessmentBlueprintConfig {
    courseId: number;
    name: string;
    type: AssessmentType;
    description: string;
    semester: string;
}

export interface SectionVariantLink {
    id: number;
    sectionId: number;
    variantId: number;
    displayOrder: number;
    metadata?: Record<string, unknown> | null;
    variant?: QuestionVariant;
}

export interface AssessmentSection {
    id: number;
    assessmentId: number;
    name: string;
    description?: string | null;
    sectionType?: string | null;
    difficultySettings?: Record<string, unknown> | null;
    topicFilters?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    position: number;
    createdAt: string;
    updatedAt: string;
    sectionVariants?: SectionVariantLink[];
}

export interface AssessmentSectionCreateInput {
    name: string;
    description?: string;
    sectionType?: string;
    difficultySettings?: Record<string, unknown> | null;
    topicFilters?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    position?: number;
    questionTypes?: QuestionType[];
    reasoningData?: ReasoningDataState;
}
