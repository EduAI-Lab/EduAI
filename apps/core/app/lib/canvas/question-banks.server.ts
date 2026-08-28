import type { CanvasIntegrationCredentials } from "~/lib/canvas/client.server";
import { canvasGetPaginated, canvasRequestJson } from "~/lib/canvas/client.server";

export type CanvasQuestionBankApi = {
  id: number;
  title?: string;
  name?: string;
  question_count?: number;
};

export type CanvasQuestionBankQuestionApi = {
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

export async function listCanvasQuestionBanks(
  credentials: CanvasIntegrationCredentials,
  canvasCourseId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<CanvasQuestionBankApi[]> {
  // Page-walked: a course can hold more banks than one Canvas page returns.
  const banks = await canvasGetPaginated<CanvasQuestionBankApi>(
    credentials,
    `/question_banks?context_type=Course&context_id=${encodeURIComponent(String(canvasCourseId))}&include_question_count=true`,
    fetchImpl,
  );
  return banks.filter(Boolean);
}

export async function getCanvasQuestionBank(
  credentials: CanvasIntegrationCredentials,
  canvasBankId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<CanvasQuestionBankApi> {
  return canvasRequestJson<CanvasQuestionBankApi>(
    credentials,
    `/question_banks/${encodeURIComponent(String(canvasBankId))}?include_question_count=true`,
    {},
    fetchImpl,
  );
}

export async function listCanvasQuestionBankQuestions(
  credentials: CanvasIntegrationCredentials,
  canvasBankId: number,
  { page = 1, perPage = 100 }: { page?: number; perPage?: number } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<CanvasQuestionBankQuestionApi[]> {
  const data = await canvasRequestJson<
    CanvasQuestionBankQuestionApi[] | CanvasQuestionBankQuestionApi
  >(
    credentials,
    `/question_banks/${encodeURIComponent(String(canvasBankId))}/questions?per_page=${perPage}&page=${page}`,
    {},
    fetchImpl,
  );
  const questions = Array.isArray(data) ? data : [data];
  return questions.filter(Boolean);
}
