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

export interface EduAITopicOption {
    id: string;
    name: string;
}

const MOCK_COURSE_OPTIONS: EduAICourseOption[] = [
    {
        id: 'COSC211',
        code: 'COSC 211',
        name: 'Machine Architecture',
        description: 'Computer organization, performance, and instruction set design.'
    },
    {
        id: 'COSC121',
        code: 'COSC 121',
        name: 'Computer Programming II',
        description: 'Intermediate programming with data structures and software design.'
    }
];

// Mock topics mapped by course code (without spaces)
const MOCK_COURSE_TOPICS_BY_CODE: Record<string, EduAITopicOption[]> = {
    'COSC211': [
        { id: 'cosc211-1', name: 'Instruction Set Architectures' },
        { id: 'cosc211-2', name: 'Pipeline Design' },
        { id: 'cosc211-3', name: 'Cache Coherence Strategies' },
        { id: 'cosc211-4', name: 'Memory Hierarchy' },
        { id: 'cosc211-5', name: 'Parallel Execution Models' },
        { id: 'cosc211-6', name: 'Performance Benchmarking' }
    ],
    'COSC121': [
        { id: 'cosc121-1', name: 'Object-Oriented Design' },
        { id: 'cosc121-2', name: 'Data Structures Fundamentals' },
        { id: 'cosc121-3', name: 'Algorithm Analysis' },
        { id: 'cosc121-4', name: 'Testing and Debugging' },
        { id: 'cosc121-5', name: 'File I/O and Persistence' },
        { id: 'cosc121-6', name: 'Recursion Patterns' }
    ]
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
        const response = await api.get('/api/eduai/test-api-key');
        return response.data;
    }

    /**
     * Fetch available AI models from the AI service
     */
    async listModels(): Promise<EduAIModelOption[]> {
        try {
            const response = await api.get('/api/eduai/ai-models');
            const models = response.data;

            // Transform API response to our format
            return models
                .filter((model: any) => model.isActive)
                .map((model: any) => ({
                    id: `${model.provider.name}:${model.modelId}`,
                    label: model.name,
                    provider: model.provider.name,
                    description: model.description,
                    isDefault: model.modelId === 'gpt-oss:120b' // Default to ollama model
                }));
        } catch (error) {
            console.error('Failed to fetch AI models from the AI service:', error);
            return [];
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
            throw error;
        }
    }

    /**
     * Mock: Return topic list for a course.
     * Topics are looked up by course code (e.g., "COSC 211" -> "COSC211")
     * courseIdOrCode can be either the AI service course UUID or the course code
     * Replace with live API call when endpoint is available.
     */
    async listCourseTopics(courseIdOrCode: string, courseCode?: string): Promise<EduAITopicOption[]> {
        // For now, skip the live endpoint since it doesn't work yet
        // Use mock topics based on course code
        const codeToMatch = courseCode || courseIdOrCode;
        const normalizedCode = codeToMatch.replace(/\s+/g, '').toUpperCase();

        // Try exact match first (e.g., "COSC211")
        if (MOCK_COURSE_TOPICS_BY_CODE[normalizedCode]) {
            return MOCK_COURSE_TOPICS_BY_CODE[normalizedCode];
        }

        // Try with space variations (e.g., "COSC 211" -> "COSC211")
        for (const [code, topics] of Object.entries(MOCK_COURSE_TOPICS_BY_CODE)) {
            const normalizedMockCode = code.replace(/\s+/g, '');
            if (normalizedCode === normalizedMockCode) {
                return topics;
            }
        }

        return [];
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
