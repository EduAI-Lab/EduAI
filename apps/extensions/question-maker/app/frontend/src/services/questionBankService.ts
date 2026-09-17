/**
 * API client for per-course question banks and membership.
 * Bank ids are Core CUIDs (strings); QM proxies to EduAI Core.
 */
import api from "./api";

export interface QuestionBank {
  id: string;
  courseId: number;
  name: string;
  description?: string | null;
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const questionBankService = {
  async listBanks(courseId: number): Promise<QuestionBank[]> {
    const response = await api.get(`/api/course/${courseId}/banks`);
    return response.data.data || [];
  },

  async createBank(
    courseId: number,
    payload: { name: string; description?: string },
  ): Promise<QuestionBank> {
    const response = await api.post(`/api/course/${courseId}/banks`, payload);
    return response.data.data;
  },

  async updateBank(
    courseId: number,
    bankId: string,
    payload: { name?: string; description?: string | null },
  ): Promise<QuestionBank> {
    const response = await api.put(`/api/course/${courseId}/banks/${bankId}`, payload);
    return response.data.data;
  },

  async deleteBank(
    courseId: number,
    bankId: string,
    moveMembershipsToBankId?: string,
  ): Promise<void> {
    await api.delete(`/api/course/${courseId}/banks/${bankId}`, {
      data: moveMembershipsToBankId ? { moveMembershipsToBankId } : undefined,
    });
  },

  async addQuestionToBank(
    courseId: number,
    bankId: string,
    questionMetadataId: number,
  ): Promise<void> {
    await api.post(`/api/course/${courseId}/banks/${bankId}/questions`, {
      questionMetadataId,
    });
  },

  async removeQuestionFromBank(
    courseId: number,
    bankId: string,
    questionMetadataId: number,
  ): Promise<void> {
    await api.delete(`/api/course/${courseId}/banks/${bankId}/questions/${questionMetadataId}`);
  },

  /** Bank ids that already hold this question — targets the picker must rule out. */
  async listBankIdsForQuestion(courseId: number, questionMetadataId: number): Promise<string[]> {
    const response = await api.get(`/api/course/${courseId}/banks/questions/${questionMetadataId}`);
    return response.data.data?.bankIds || [];
  },

  /** Moves one question out of `fromBankId` into `targetBankId` in a single call. */
  async moveQuestionToBank(
    courseId: number,
    fromBankId: string,
    questionMetadataId: number,
    targetBankId: string,
  ): Promise<void> {
    await api.post(
      `/api/course/${courseId}/banks/${fromBankId}/questions/${questionMetadataId}/move`,
      { targetBankId },
    );
  },
};

export default questionBankService;
