import { tool } from "ai";
import { z } from "zod";

import { findRelevantContent } from "~/lib/ai/embedding";
import { capRagHitsForTool, HYBRID_RAG_MAX_CHUNKS } from "~/lib/chat-rag";
import { fetchPage, webSearch } from "~/lib/ai/tools";
import type { ChatToolContext } from "./chat-mode";

/** Learning assistant tools — original set: RAG + web search only. */
export function createLearningChatTools(ctx: ChatToolContext) {
  const { effectiveCourseId } = ctx;

  return {
    getInformation: tool({
      description:
        "Search uploaded course materials to answer questions about course content. Use this FIRST for course-related queries.",
      parameters: z.object({
        question: z.string().describe("The user's question about course content"),
      }),
      execute: async ({ question }) => {
        if (!effectiveCourseId) {
          return { error: "No course selected for RAG search" };
        }

        try {
          const relevantContent = await findRelevantContent(
            question,
            effectiveCourseId,
            HYBRID_RAG_MAX_CHUNKS,
          );
          const capped = capRagHitsForTool(relevantContent);
          return {
            relevantContent: capped,
            count: capped.length,
          };
        } catch (error) {
          console.error("Error finding relevant content:", error);
          return { error: "Failed to search course materials" };
        }
      },
    }),
    webSearch,
    fetchPage,
  };
}

export type { ChatToolContext } from "./chat-mode";
