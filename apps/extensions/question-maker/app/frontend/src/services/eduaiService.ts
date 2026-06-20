/**
 * Frontend wrapper around AI service endpoints for chat, question generation, course/topics, and model list.
 * Passes through provider API keys as needed and returns typed results.
 */
import api from './api';

export interface EduAIMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface EduAIChatRequest {
    messages: EduAIMessage[];
    model?: string;
    apiKeys?: Record<string, any>;
    courseCode: string;
    streaming?: boolean;
}

export interface EduAIChatResponse {
    success: boolean;
    data: any;
    course: {
        id: number;
        name: string;
        code: string;
    };
}

export interface EduAIQuestionGenerationRequest {
    prompt: string;
    courseCode: string;
    model?: string;
    apiKeys?: Record<string, any>;
    numQuestions?: number;
    difficultyDistribution?: {
        easy: number;
        medium: number;
        hard: number;
    };
    reasoningDistribution?: {
        factual: number;
        analytical: number;
        application: number;
    };
    /** When set (2–26), MCQ outputs must use exactly this many choices (variant parity with originals). */
    mcqRequiredChoiceCount?: number;
}

export interface EduAIQuestionGenerationResponse {
    success: boolean;
    data: {
        questions: Array<{
            content: string;
            description?: string;
            difficulty: 'easy' | 'medium' | 'hard';
            reasoning_level: 'factual' | 'analytical' | 'application';
            bloom_level: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
            type: 'MCQ' | 'SA' | 'LA';
            answer?: string;
            choices?: Array<{ letter: string; text: string }>;
            primary_topic_id?: number | null;
            secondary_topic_ids?: number[];
        }>;
        count: number;
        course: {
            id: number;
            name: string;
            code: string;
        };
    };
}

export interface EduAIModelOption {
    id: string;
    label: string;
    provider: string;
    description?: string;
    isDefault?: boolean;
}

export interface EduAICourseOption {
    id: string;
    code: string;
    name: string;
    description?: string;
    term?: string;
    year?: number;
}

export interface EduAITopicOption {
    id: string;
    name: string;
}

/** Shown when Core model list is unreachable (offline / auth). */
const FALLBACK_AI_MODELS: EduAIModelOption[] = [
    {
        id: 'google:gemini-2.5-flash',
        label: 'Gemini 2.5 Flash (fallback)',
        provider: 'google',
        description: 'Used when the live model list cannot be loaded.',
        isDefault: true,
    },
    {
        id: 'ollama:gpt-oss:120b',
        label: 'Ollama GPT-OSS 120B (fallback)',
        provider: 'ollama',
    },
];

const FALLBACK_COURSE_OPTIONS: EduAICourseOption[] = [
    {
        id: 'fallback-cosc211',
        code: 'COSC 211',
        name: 'Machine Architecture',
        description: 'Offline fallback — link courses from your profile when Core is available.',
    },
    {
        id: 'fallback-cosc121',
        code: 'COSC 121',
        name: 'Computer Programming II',
        description: 'Offline fallback — link courses from your profile when Core is available.',
    },
];

/** Legacy mock topics — only used when Core topic fetch fails. */
const FALLBACK_TOPICS_BY_CODE: Record<string, EduAITopicOption[]> = {
    COSC211: [
        { id: 'fallback-1', name: 'Instruction Set Architectures' },
        { id: 'fallback-2', name: 'Pipeline Design' },
    ],
    COSC121: [
        { id: 'fallback-1', name: 'Object-Oriented Design' },
        { id: 'fallback-2', name: 'Data Structures Fundamentals' },
    ],
};

export interface EduAITestResponse {
    success: boolean;
    message?: string;
    error?: string;
    configured: boolean;
}

class EduAIService {
    /** Sends a chat message to the AI service with course context. */
    async chat(request: EduAIChatRequest): Promise<EduAIChatResponse> {
        const response = await api.post('/api/eduai/chat', request);
        return response.data;
    }

    /** Generates questions via the AI service with the provided course/prompt/model settings. */
    async generateQuestions(request: EduAIQuestionGenerationRequest): Promise<EduAIQuestionGenerationResponse> {
        const response = await api.post('/api/eduai/generate-questions', request);
        return response.data;
    }

    /** Tests configured AI service credentials by calling the backend validation endpoint. */
    async testApiKey(): Promise<EduAITestResponse> {
        try {
            const response = await api.get('/api/eduai/test-api-key');
            return response.data;
        } catch (err: any) {
            if (err.response?.status === 400 && err.response?.data) {
                return {
                    ...err.response.data,
                    configured: err.response.data.configured ?? true
                };
            }
            throw err;
        }
    }

    /**
     * Fetch available AI models from the AI service
     */
    async listModels(): Promise<EduAIModelOption[]> {
        try {
            const response = await api.get('/api/eduai/ai-models');
            const models = response.data;

            if (!Array.isArray(models) || models.length === 0) {
                return FALLBACK_AI_MODELS;
            }

            return models
                .filter((model: any) => model.isActive !== false)
                .map((model: any) => ({
                    id: `${model.provider?.name ?? model.provider}:${model.modelId}`,
                    label: model.name ?? model.modelId,
                    provider: model.provider?.name ?? String(model.provider ?? 'unknown'),
                    description: model.description,
                    isDefault: model.modelId === 'gpt-oss:120b' || model.modelId === 'gemini-2.5-flash',
                }));
        } catch (error) {
            console.error('Failed to fetch AI models from the AI service:', error);
            return FALLBACK_AI_MODELS;
        }
    }

    /**
     * Retrieve all courses from the AI service via backend proxy.
     * Each unique combination of code, name, term, and year is a separate course.
     */
    async listCourses(): Promise<EduAICourseOption[]> {
        try {
            const response = await api.get('/api/eduai/courses');
            const coursesData = response.data.data;

            // Transform AI service API response to our format
            if (coursesData && Array.isArray(coursesData.courses)) {
                return coursesData.courses.map((course: any) => ({
                    id: course.id,
                    code: course.code,
                    name: course.name,
                    description: course.description || `${course.term} ${course.year}`,
                    term: course.term,
                    year: course.year
                }));
            }

            return [];
        } catch (error) {
            console.error('Failed to fetch courses from the AI service:', error);
            return FALLBACK_COURSE_OPTIONS;
        }
    }

    private fallbackTopicsForCode(courseIdOrCode: string, courseCode?: string): EduAITopicOption[] {
        const codeToMatch = courseCode || courseIdOrCode;
        const normalizedCode = codeToMatch.replace(/\s+/g, '').toUpperCase();
        return FALLBACK_TOPICS_BY_CODE[normalizedCode] ?? [];
    }

    /**
     * Fetch topics for a course — tries Core API first, then code-based fallback.
     */
    async listCourseTopics(courseIdOrCode: string, courseCode?: string): Promise<EduAITopicOption[]> {
        const looksLikeCoreId = courseIdOrCode.length > 12 && !courseIdOrCode.includes(' ');
        if (looksLikeCoreId) {
            const coreTopics = await this.listCoreCourseTopics(courseIdOrCode);
            if (coreTopics.length > 0) return coreTopics;
        }

        try {
            const response = await api.get(`/api/eduai/courses/${encodeURIComponent(courseIdOrCode)}/topics`);
            const topics = response.data?.data?.topics ?? [];
            if (Array.isArray(topics) && topics.length > 0) {
                return topics.map((topic: { id: string; name: string }) => ({
                    id: topic.id,
                    name: topic.name,
                }));
            }
        } catch (error) {
            console.warn('Live topic fetch failed, using fallback topics if available:', error);
        }

        return this.fallbackTopicsForCode(courseIdOrCode, courseCode);
    }

    /**
     * Fetch course topics from Core via backend proxy (courseId is a Core CUID).
     */
    async listCoreCourseTopics(coreCourseId: string): Promise<EduAITopicOption[]> {
        try {
            const response = await api.get(`/api/eduai/courses/${coreCourseId}/topics`);
            const topics = response.data?.data?.topics ?? [];
            if (!Array.isArray(topics)) {
                return [];
            }
            return topics.map((topic: { id: string; name: string }) => ({
                id: topic.id,
                name: topic.name
            }));
        } catch (error) {
            console.error('Failed to fetch Core course topics:', error);
            return this.fallbackTopicsForCode(coreCourseId);
        }
    }

    /**
     * Live: Fetch course topics from the AI service via backend proxy.
     */
    async fetchCourseTopics(courseId: string): Promise<any> {
        const response = await api.get(`/api/eduai/courses/${courseId}/topics`);
        return response.data;
    }

    /**
     * Helper method to create a simple chat message
     */
    createMessage(role: 'user' | 'assistant' | 'system', content: string): EduAIMessage {
        return { role, content };
    }

    /**
     * Helper method to create a question generation request
     */
    createQuestionGenerationRequest(
        prompt: string,
        courseCode: string,
        options: Partial<EduAIQuestionGenerationRequest> = {}
    ): EduAIQuestionGenerationRequest {
        return {
            prompt,
            courseCode,
            model: 'google:gemini-2.5-flash',
            numQuestions: 5,
            difficultyDistribution: { easy: 1, medium: 2, hard: 2 },
            reasoningDistribution: { factual: 40, analytical: 30, application: 30 },
            ...options
        };
    }

    /**
     * Helper method to create a chat request
     */
    createChatRequest(
        messages: EduAIMessage[],
        courseCode: string,
        options: Partial<EduAIChatRequest> = {}
    ): EduAIChatRequest {
        return {
            messages,
            courseCode,
            model: 'google:gemini-2.5-flash',
            streaming: false,
            ...options
        };
    }
}

export const eduaiService = new EduAIService();
export default eduaiService;
