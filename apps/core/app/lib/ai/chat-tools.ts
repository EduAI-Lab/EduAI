import { tool } from "ai";
import { z } from "zod";
import { findRelevantContent } from "~/lib/ai/embedding";
import { webSearch, fetchPage } from "~/lib/ai/tools";
import {
  capRagHitsForTool,
  HYBRID_RAG_MAX_CHUNKS,
} from "~/lib/chat-rag";

export function buildChatToolRegistry(options: {
  effectiveCourseId: string | null;
  webToolsEnabled: boolean;
  /** #839: when true (student caller), exclude hidden/scheduled materials from RAG. */
  restrictToStudentVisible?: boolean;
}) {
  const registry = {
    getInformation: tool({
      description:
        "Search uploaded course materials to answer questions about course content. Use when pre-loaded excerpts are insufficient.",
      parameters: z.object({
        question: z.string().describe("The user's question about course content"),
      }),
      execute: async ({ question }) => {
        if (!options.effectiveCourseId) {
          return { error: "No course selected for RAG search" };
        }

        try {
          const relevantContent = await findRelevantContent(
            question,
            options.effectiveCourseId,
            HYBRID_RAG_MAX_CHUNKS,
            undefined,
            options.restrictToStudentVisible ?? false,
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
  };

  if (options.webToolsEnabled) {
    return { ...registry, webSearch, fetchPage };
  }

  return registry;
}

export type ChatToolRegistry = ReturnType<typeof buildChatToolRegistry>;

export function getChatToolNames(registry: ChatToolRegistry): string[] {
  return Object.keys(registry).sort();
}

export function buildToolCallingSystemPrompt(options: {
  basePrompt: string;
  courseCode?: string;
  webToolsEnabled: boolean;
  hasPreloadedRag: boolean;
}): string {
  const courseLine = options.courseCode
    ? `Current course context: ${options.courseCode} (UBCO). Do not ask the user for the course code if it's provided.`
    : "";

  const ragLine = options.hasPreloadedRag
    ? "Course excerpts are already included in this system message. Use getInformation only if those excerpts are insufficient."
    : "For course content questions, call getInformation to retrieve relevant materials.";

  const webLines = options.webToolsEnabled
    ? `- webSearch: searches the web for current information, reviews, discussions, news, etc.
- fetchPage: opens a URL and returns the main page content as markdown for deeper reading.

When the user asks for reviews, opinions, recent updates, or external information, call webSearch after checking course materials. After webSearch, call fetchPage on promising sources before answering.`
    : "";

  const webCitation = options.webToolsEnabled
    ? " Always cite URLs for web results."
    : "";

  return `${options.basePrompt}

You have access to getInformation for uploaded course materials.${options.webToolsEnabled ? " Web tools (webSearch, fetchPage) are enabled for this deployment." : ""}
${webLines ? `\n${webLines}` : ""}

When answering questions:
1. ${ragLine}
${options.webToolsEnabled ? "2. Use web tools only when the question clearly needs external or up-to-date information.\n3. You may call tools multiple times in sequence if needed.\n4. Cite course material titles for RAG results.${webCitation}" : "2. You may call getInformation multiple times if needed.\n3. Cite course material titles for RAG results."}

${courseLine}

Be helpful, conversational, and accurate. Use markdown for formatting.`.trim();
}
