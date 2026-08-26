import { tool } from "ai";
import { z } from "zod";

import { runCourseMaterialSearchTool } from "~/lib/chat-rag";
import { fetchPage, webSearch } from "~/lib/ai/tools";
import type { ChatToolContext } from "./chat-mode";

/** Learning assistant tools — original set: RAG + web search only. */
export function createLearningChatTools(ctx: ChatToolContext) {
  const { effectiveCourseId, restrictToStudentVisible } = ctx;

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

        return runCourseMaterialSearchTool(
          question,
          effectiveCourseId,
          restrictToStudentVisible ?? false,
        );
      },
    }),
    webSearch,
    fetchPage,
  };
}

export type { ChatToolContext } from "./chat-mode";
