import type { LanguageModel } from "ai";

import { buildAdminSystemPrompt } from "./admin-chat-prompts";

export type AdminStreamConfigInput = {
  aiModel: LanguageModel;
  modelMessages: Record<string, unknown>[];
  streaming: boolean;
  tools: Record<string, unknown>;
  courseCode?: string | null;
  effectiveCourseId: string | null;
  resolvedSystemPrompt: string | null;
  toolMaxTokens: number;
  toolMaxSteps: number;
};

export type ChatStreamResult = {
  config: Record<string, unknown>;
  approach: "tool_calling";
};

/** Admin chatbot stream config — always tool-calling, no RAG. */
export function buildAdminChatStreamConfig(input: AdminStreamConfigInput): ChatStreamResult {
  const system = buildAdminSystemPrompt({
    courseCode: input.courseCode,
    effectiveCourseId: input.effectiveCourseId,
    customPrompt: input.resolvedSystemPrompt,
  });

  return {
    approach: "tool_calling",
    config: {
      model: input.aiModel,
      messages: input.modelMessages,
      temperature: 0.2,
      maxTokens: input.toolMaxTokens,
      maxSteps: input.toolMaxSteps,
      tools: input.tools,
      toolCallStreaming: input.streaming,
      system,
    },
  };
}
