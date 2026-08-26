import type { CanvasIntegrationCredentials } from "~/lib/canvas/client.server";
import { canvasRequestJson } from "~/lib/canvas/client.server";
import type { JsonObject } from "~/lib/json-value";

export type CanvasQuizApi = {
  id: number;
  title: string;
  quiz_type?: string;
  published?: boolean;
  description?: string;
};

export type CanvasQuizQuestionApi = {
  id: number;
  question_name?: string;
  question_text?: string;
  question_type?: string;
  position?: number;
  answers?: Array<{
    id?: number;
    answer_text?: string;
    answer_weight?: number;
    answer_comment?: string;
  }>;
};

export async function listCanvasQuizzes(
  credentials: CanvasIntegrationCredentials,
  canvasCourseId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<CanvasQuizApi[]> {
  return canvasRequestJson<CanvasQuizApi[]>(
    credentials,
    `/courses/${canvasCourseId}/quizzes`,
    {},
    fetchImpl,
  );
}

export async function getCanvasQuiz(
  credentials: CanvasIntegrationCredentials,
  canvasCourseId: number,
  quizId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<CanvasQuizApi> {
  return canvasRequestJson<CanvasQuizApi>(
    credentials,
    `/courses/${canvasCourseId}/quizzes/${quizId}`,
    {},
    fetchImpl,
  );
}

export async function listCanvasQuizQuestions(
  credentials: CanvasIntegrationCredentials,
  canvasCourseId: number,
  quizId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<CanvasQuizQuestionApi[]> {
  return canvasRequestJson<CanvasQuizQuestionApi[]>(
    credentials,
    `/courses/${canvasCourseId}/quizzes/${quizId}/questions`,
    {},
    fetchImpl,
  );
}

export async function getCanvasQuizQuestion(
  credentials: CanvasIntegrationCredentials,
  canvasCourseId: number,
  quizId: number,
  questionId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<CanvasQuizQuestionApi> {
  return canvasRequestJson<CanvasQuizQuestionApi>(
    credentials,
    `/courses/${canvasCourseId}/quizzes/${quizId}/questions/${questionId}`,
    {},
    fetchImpl,
  );
}

export async function createCanvasQuiz(
  credentials: CanvasIntegrationCredentials,
  canvasCourseId: number,
  quizPayload: JsonObject,
  fetchImpl: typeof fetch = fetch,
): Promise<CanvasQuizApi> {
  return canvasRequestJson<CanvasQuizApi>(
    credentials,
    `/courses/${canvasCourseId}/quizzes`,
    { method: "POST", body: { quiz: quizPayload } },
    fetchImpl,
  );
}

export async function createCanvasQuizQuestion(
  credentials: CanvasIntegrationCredentials,
  canvasCourseId: number,
  quizId: number,
  questionPayload: JsonObject,
  fetchImpl: typeof fetch = fetch,
): Promise<CanvasQuizQuestionApi> {
  return canvasRequestJson<CanvasQuizQuestionApi>(
    credentials,
    `/courses/${canvasCourseId}/quizzes/${quizId}/questions`,
    { method: "POST", body: { question: questionPayload } },
    fetchImpl,
  );
}
