import type { LanguageModel } from "ai";

import { findRelevantContent } from "~/lib/ai/embedding";
import {
  buildCappedRagContextText,
  extractMessageText,
  HYBRID_RAG_MAX_CHUNKS,
  HYBRID_RAG_MAX_CONTEXT_CHARS,
} from "~/lib/chat-rag";
import {
  buildLearningAssistantSystemPrompt,
  buildLearningSystemPrompt,
} from "./learning-chat-prompts";
import type { ChatStreamResult } from "./admin-chat-stream.server";

export type LearningStreamConfigInput = {
  aiModel: LanguageModel;
  modelMessages: Record<string, unknown>[];
  trimmedMessages: Record<string, unknown>[];
  streaming: boolean;
  tools: Record<string, unknown>;
  effectiveCourseId: string | null;
  courseCode?: string | null;
  resolvedSystemPrompt: string | null;
  supportsTools: boolean;
  toolMaxTokens: number;
  toolMaxSteps: number;
};

type LearningStreamResult = ChatStreamResult & {
  approach: "tool_calling" | "hybrid_rag";
};

function buildNonToolPrompt(
  courseCode: string | null | undefined,
  resolvedSystemPrompt: string | null,
  citeMaterials: boolean,
) {
  return buildLearningAssistantSystemPrompt({
    courseCode,
    customPrompt: resolvedSystemPrompt,
    citeMaterials,
  });
}

/** Learning chatbot stream config — tool-calling or hybrid RAG fallback. */
export async function buildLearningChatStreamConfig(
  input: LearningStreamConfigInput,
): Promise<LearningStreamResult> {
  if (input.supportsTools) {
    return {
      approach: "tool_calling",
      config: {
        model: input.aiModel,
        messages: input.modelMessages,
        temperature: 0.6,
        maxTokens: input.toolMaxTokens,
        maxSteps: input.toolMaxSteps,
        tools: input.tools,
        toolCallStreaming: input.streaming,
        system: buildLearningSystemPrompt({
          courseCode: input.courseCode,
          customPrompt: input.resolvedSystemPrompt,
        }),
      },
    };
  }

  const lastUserMessage = [...input.trimmedMessages]
    .reverse()
    .find((message) => message.role === "user");
  const userQuestion = extractMessageText(lastUserMessage);
  const messageContentLower = userQuestion.toLowerCase();

  const hybridRagAlwaysWithCourse = process.env.CHAT_HYBRID_RAG_ALWAYS_WITH_COURSE === "1";
  const isRAGQuery =
    Boolean(input.effectiveCourseId) &&
    (hybridRagAlwaysWithCourse ||
      messageContentLower.includes("course") ||
      messageContentLower.includes("material") ||
      messageContentLower.includes("document") ||
      messageContentLower.includes("chapter") ||
      messageContentLower.includes("lecture") ||
      messageContentLower.includes("assignment") ||
      messageContentLower.includes("explain") ||
      messageContentLower.includes("what is") ||
      messageContentLower.includes("summarize") ||
      messageContentLower.includes("summary") ||
      messageContentLower.includes("content") ||
      messageContentLower.includes("about"));

  if (isRAGQuery) {
    try {
      const relevantContent = await findRelevantContent(
        userQuestion || messageContentLower,
        input.effectiveCourseId!,
        HYBRID_RAG_MAX_CHUNKS,
      );
      const contextText =
        relevantContent.length > 0
          ? buildCappedRagContextText(
              relevantContent,
              HYBRID_RAG_MAX_CHUNKS,
              HYBRID_RAG_MAX_CONTEXT_CHARS,
            )
          : "";

      const baseSystemPrompt = buildNonToolPrompt(
        input.courseCode,
        input.resolvedSystemPrompt,
        true,
      );

      const systemWithRAG = contextText
        ? `${baseSystemPrompt}

${contextText ? `Here are relevant excerpts from the course materials to help answer the user's question:

${contextText}

Based on this information, provide a comprehensive answer to the user's question. If the provided content doesn't fully answer their question, mention what you can answer based on the available materials and suggest what additional information might be helpful.` : "I don't have access to specific course materials for this question, but I can provide general educational assistance."}`
        : baseSystemPrompt;

      return {
        approach: "hybrid_rag",
        config: {
          model: input.aiModel,
          messages: input.modelMessages,
          temperature: 0.6,
          maxTokens: 8192,
          system: systemWithRAG,
        },
      };
    } catch (error) {
      console.error("Error finding relevant content for model without tool support:", error);
    }
  }

  return {
    approach: "hybrid_rag",
    config: {
      model: input.aiModel,
      messages: input.modelMessages,
      temperature: 0.6,
      maxTokens: 8192,
      system: buildNonToolPrompt(input.courseCode, input.resolvedSystemPrompt, false),
    },
  };
}
