/**
 * Canvas API client for integration status, course listings, exports, and imports.
 * Mirrors backend routes and shapes data for frontend consumption.
 */
import api from "./api";
import { getCanvasDefaultUrl } from "./canvasDefaults";

export interface CanvasIntegration {
  canvasUrl: string;
  isTestMode: boolean;
  isConnected: boolean;
}

export interface CanvasCourse {
  id: number;
  name: string;
  course_code: string;
}

export interface CanvasExportResult {
  quizId: number;
  quizTitle: string;
  questionsCreated: number;
  canvasUrl: string;
}

export interface CanvasQuiz {
  id: number;
  title: string;
  quiz_type: string;
  published: boolean;
  description?: string;
}

export interface CanvasQuestion {
  id: number;
  question_name: string;
  question_text: string;
  question_type: string;
  position: number;
  answers: Array<{
    id: number;
    answer_text: string;
    answer_weight: number;
  }>;
}

export interface CanvasSkippedQuestion {
  position: number;
  name: string;
  type: string;
  reason: string;
}

export interface CanvasImportResult {
  assessmentId: number;
  assessmentName: string;
  questionsImported: number;
  questionsSkipped?: number;
  skippedQuestions?: CanvasSkippedQuestion[];
  sectionId: number;
}

export interface CanvasQuestionBank {
  id: number;
  title?: string;
  name?: string;
  question_count?: number;
}

export interface CanvasBankSyncResult {
  bankId: string;
  created: number;
  updated: number;
  skipped: number;
  lastSyncedAt?: string;
}

/** The Canvas course a local course is linked to, as the mapping endpoint returns it. */
export interface CanvasCourseMapping {
  localCourseId: number;
  canvasCourseId: number;
  canvasCourseName: string | null;
  source?: "local" | "core";
}

export const canvasService = {
  /** True when local dev should prefer Canvas test mode (set VITE_CANVAS_TEST_MODE=true). */
  prefersTestMode(): boolean {
    return import.meta.env.VITE_CANVAS_TEST_MODE === "true";
  },

  /** Connect with optional fallback to test mode when live credentials fail. */
  async connectCanvasWithFallback(
    canvasUrl: string,
    apiKey: string,
    options: { preferTestMode?: boolean } = {},
  ): Promise<{ integration: CanvasIntegration; usedTestMode: boolean }> {
    const preferTestMode = options.preferTestMode ?? this.prefersTestMode();
    const defaultUrl = getCanvasDefaultUrl(import.meta.env.DEV);
    if (preferTestMode) {
      const integration = await this.connectCanvas(
        canvasUrl || defaultUrl,
        apiKey || "test-key",
        true,
      );
      return { integration, usedTestMode: true };
    }

    try {
      const integration = await this.connectCanvas(canvasUrl, apiKey, false);
      return { integration, usedTestMode: false };
    } catch (error) {
      const allowTestFallback = this.prefersTestMode() || import.meta.env.DEV;
      if (!allowTestFallback) {
        throw error;
      }
      console.warn("Canvas live connect failed; retrying in test mode", error);
      const integration = await this.connectCanvas(
        canvasUrl || defaultUrl,
        apiKey || "test-key",
        true,
      );
      return { integration, usedTestMode: true };
    }
  },

  /** Fetches the current user's Canvas integration status (or null). */
  async getIntegration(): Promise<CanvasIntegration | null> {
    try {
      const response = await api.get("/api/canvas/integration");
      return response.data.data;
    } catch (error) {
      console.error("Failed to get Canvas integration:", error);
      return null;
    }
  },

  /** Connects a Canvas account or test mode and returns the saved integration. */
  async connectCanvas(
    canvasUrl: string,
    apiKey: string,
    isTestMode: boolean = false,
  ): Promise<CanvasIntegration> {
    const response = await api.post("/api/canvas/connect", {
      canvasUrl,
      apiKey,
      isTestMode,
    });
    return response.data.data;
  },

  /** Disconnects the user's Canvas integration. */
  async disconnectCanvas(): Promise<void> {
    await api.delete("/api/canvas/disconnect");
  },

  /** Lists Canvas courses for the connected user. */
  async getCourses(): Promise<CanvasCourse[]> {
    const response = await api.get("/api/canvas/courses");
    return response.data.data || [];
  },

  /** Exports an assessment to a Canvas course, returning quiz details. */
  /**
   * Exports an assessment to Canvas. `published` defaults to true so the quiz is
   * visible in Canvas (a graded quiz is listed under Quizzes and Assignments
   * only once published, #1556); pass false to leave it as a draft.
   */
  async exportAssessment(
    assessmentId: number,
    canvasCourseId: number,
    options: { published?: boolean } = {},
  ): Promise<CanvasExportResult> {
    const response = await api.post(`/api/canvas/export/${assessmentId}`, {
      canvasCourseId,
      published: options.published !== false,
    });
    return response.data.data;
  },

  /** Retrieves the stored mapping for a local course to its Canvas course ID. */
  async getCourseMapping(courseId: number) {
    try {
      const response = await api.get(`/api/canvas/mapping/${courseId}`);
      return response.data.data;
    } catch (error) {
      return null;
    }
  },

  /**
   * The course's Canvas link with the failure kept separate from the answer.
   *
   * `getCourseMapping` collapses a Core hiccup, a 500 and a dropped connection
   * into the same `null` a genuinely unlinked course returns. That is fine
   * where the caller only offers a Canvas action, but a caller that *hides*
   * things on "unlinked" would strip every Canvas affordance from a linked
   * course on one transient error, with nothing on screen to explain it
   * (#1652 review). `"unknown"` lets such a caller leave the UI alone.
   */
  async getCourseLink(
    courseId: number,
  ): Promise<
    { status: "linked"; mapping: CanvasCourseMapping } | { status: "unlinked" | "unknown" }
  > {
    try {
      const response = await api.get(`/api/canvas/mapping/${courseId}`);
      const mapping = response.data.data;
      return mapping?.canvasCourseId ? { status: "linked", mapping } : { status: "unlinked" };
    } catch {
      return { status: "unknown" };
    }
  },

  /**
   * Get quizzes from a Canvas course
   */
  async getQuizzes(canvasCourseId: number): Promise<CanvasQuiz[]> {
    const response = await api.get(`/api/canvas/courses/${canvasCourseId}/quizzes`);
    return response.data.data || [];
  },

  /**
   * Get questions from a Canvas quiz
   */
  async getQuizQuestions(canvasCourseId: number, quizId: number): Promise<CanvasQuestion[]> {
    const response = await api.get(
      `/api/canvas/courses/${canvasCourseId}/quizzes/${quizId}/questions`,
    );
    return response.data.data || [];
  },

  /**
   * Import a Canvas quiz as an assessment
   */
  async importQuiz(
    canvasCourseId: number,
    quizId: number,
    localCourseId: number,
    options: {
      assessmentType?: string;
      assessmentName?: string;
      /** Local topic CUID — never coerced to a number (#1652 review). */
      primaryTopicId: string;
    },
  ): Promise<CanvasImportResult> {
    const response = await api.post(`/api/canvas/import/${canvasCourseId}/quizzes/${quizId}`, {
      localCourseId,
      ...options,
    });
    return response.data.data;
  },

  async getQuestionBanks(canvasCourseId: number): Promise<CanvasQuestionBank[]> {
    const response = await api.get(`/api/canvas/courses/${canvasCourseId}/banks`);
    return response.data.data || [];
  },

  async getQuestionBankQuestions(
    canvasCourseId: number,
    canvasBankId: number,
  ): Promise<CanvasQuestion[]> {
    const response = await api.get(
      `/api/canvas/courses/${canvasCourseId}/banks/${canvasBankId}/questions`,
    );
    return response.data.data || [];
  },

  async importQuestionBank(
    canvasCourseId: number,
    canvasBankId: number,
    localCourseId: number,
    options: { primaryTopicId: string; targetBankId?: string },
  ): Promise<CanvasBankSyncResult> {
    const response = await api.post(`/api/canvas/import/${canvasCourseId}/banks/${canvasBankId}`, {
      localCourseId,
      primaryTopicId: options.primaryTopicId,
      targetBankId: options.targetBankId,
    });
    return response.data.data;
  },
};

export default canvasService;
