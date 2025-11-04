import { streamText, tool } from "ai";
import { createAIProviderRegistry, modelSupportsTools } from "~/lib/ai/providers";
import { findRelevantContent } from "~/lib/ai/embedding";
import { auth } from "~/lib/auth/server";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { webSearch, fetchPage } from "~/lib/ai/tools";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const session = await auth.api.getSession(request);
    if (!session?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // If an API key header is present, only allow ADMIN users to access this endpoint via key-based auth.
    // UI requests use session cookies and should not send x-api-key.
    const apiKeyHeader = request.headers.get('x-api-key');
    if (apiKeyHeader && session.user.role !== 'ADMIN') {
      return new Response(
        JSON.stringify({ error: "Forbidden: x-api-key access restricted to admin users" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const { messages, model, apiKeys, courseId, courseCode, streaming = true } = await request.json();

    // If courseCode is provided, resolve to internal course id
    let resolvedCourseId: string | null = null;
    if (courseCode && typeof courseCode === 'string') {
      try {
        const { default: prisma } = await import('~/lib/prisma.server');
        const course = await prisma.course.findUnique({ where: { code: courseCode } });
        resolvedCourseId = course?.id || null;
      } catch (e) {
        console.error('Failed to resolve course by code', e);
      }
    }
    const effectiveCourseId = resolvedCourseId || courseId || null;

    if (!messages || !model || !apiKeys) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Create AI provider registry with user's API keys
    const registry = createAIProviderRegistry(apiKeys);

    // Get the AI model from registry
    const aiModel = registry.languageModel(model);

    // Define tools for RAG functionality and external web search
    const tools = {
      getInformation: tool({
        description:
          "Search uploaded course materials to answer questions about course content. Use this FIRST for course-related queries.",
        parameters: z.object({
          question: z
            .string()
            .describe("The user's question about course content"),
        }),
        execute: async ({ question }) => {
          if (!effectiveCourseId) {
            return { error: "No course selected for RAG search" };
          }

          try {
            const relevantContent = await findRelevantContent(
              question,
              effectiveCourseId
            );
            return {
              relevantContent,
              count: relevantContent.length,
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

    // Check if the model supports tool calling
    const supportsTools = await modelSupportsTools(model);

    let streamConfig;

    if (!supportsTools) {
      // MODELS WITHOUT TOOL SUPPORT: Use hybrid RAG approach
      // These models need manual context injection instead of tool calling

      // Get the last user message to check if RAG might be needed
      const lastMessage = messages[messages.length - 1];
      const messageContent = typeof lastMessage?.content === 'string'
        ? lastMessage.content.toLowerCase()
        : '';

      // Detect if user is asking about course content
      const isRAGQuery = effectiveCourseId && (
        messageContent.includes('course') ||
        messageContent.includes('material') ||
        messageContent.includes('document') ||
        messageContent.includes('chapter') ||
        messageContent.includes('lecture') ||
        messageContent.includes('assignment') ||
        messageContent.includes('explain') ||
        messageContent.includes('what is') ||
        messageContent.includes('summarize') ||
        messageContent.includes('summary') ||
        messageContent.includes('content') ||
        messageContent.includes('about')
      );

      if (isRAGQuery) {
        // Manually search course materials and inject context into system prompt
        try {
          const relevantContent = await findRelevantContent(messageContent, effectiveCourseId);
          const contextText = relevantContent.length > 0
            ? relevantContent.map(item =>
                `**Source**: ${item.materialTitle || 'Course Material'}\n${item.content}`
              ).join('\n\n---\n\n')
            : '';

          streamConfig = {
            model: aiModel,
            messages,
            temperature: 0.6,
            maxTokens: 8192,
            system: `You are EduAI, a helpful AI assistant for students and faculty at UBC Okanagan (UBCO).

${courseCode ? `Current course context: ${courseCode} (UBCO). Do not ask the user for the course code if it's provided.` : ``}

${contextText ? `Here are relevant excerpts from the course materials to help answer the user's question:

${contextText}

Based on this information, provide a comprehensive answer to the user's question. If the provided content doesn't fully answer their question, mention what you can answer based on the available materials and suggest what additional information might be helpful.` : 'I don\'t have access to specific course materials for this question, but I can provide general educational assistance.'}

Always be helpful, accurate, and cite the course materials when using them in your response. Use markdown for formatting.`,
          };
        } catch (error) {
          console.error('Error finding relevant content for model without tool support:', error);
          streamConfig = {
            model: aiModel,
            messages,
            temperature: 0.6,
            maxTokens: 8192,
            system: `You are EduAI, a helpful AI assistant for students and faculty at UBC Okanagan (UBCO).

${courseCode ? `Current course context: ${courseCode} (UBCO). Do not ask the user for the course code if it's provided.` : ''}

Be helpful, conversational, and accurate. Use markdown for formatting.`,
          };
        }
      } else {
        // General conversation without RAG
        streamConfig = {
          model: aiModel,
          messages,
          temperature: 0.6,
          maxTokens: 8192,
          system: `You are EduAI, a helpful AI assistant for students and faculty at UBC Okanagan (UBCO).

${courseCode ? `Current course context: ${courseCode} (UBCO). Do not ask the user for the course code if it's provided.` : ''}

Be helpful, conversational, and accurate. Use markdown for formatting.`,
        };
      }
    } else {
      // MODELS WITH TOOL SUPPORT: Use full tool calling functionality
      streamConfig = {
        model: aiModel,
        messages,
        temperature: 0.6,
        maxTokens: 32000,
        maxSteps: 12,
        tools,
        // Disable tool call streaming for non-streaming responses
        toolCallStreaming: streaming,
        system: `You are EduAI, a helpful AI assistant for students and faculty at UBC Okanagan (UBCO).

You have access to two tools:
- getInformation: searches uploaded course materials (syllabi, lectures, assignments, etc.)
- webSearch: searches the web for current information, reviews, discussions, news, etc.
- fetchPage: opens a URL and returns the main page content as markdown for deeper reading. If a page fails to load, try other sources. Try and give a correct response to the user's query even if the page fails to load.

When answering questions:
1. For course content questions, call getInformation first to retrieve relevant materials.
2. If the user asks for reviews, opinions, recent updates, or external information (e.g., "what do students say about this course?" or "latest developments"), call webSearch after checking course materials. Prefer queries that include "UBCO" with the course code/name and the professor name when known.
3. After webSearch, call fetchPage on promising sources (e.g., RateMyProfessors, Reddit threads, official pages) to read the page content before answering. If the page fails to load, try other sources. Try and give a correct response to the user's query even if the page fails to load.
4. You may call tools multiple times in sequence if needed to give a complete answer.
5. Always cite your sources: mention course material titles for RAG results and include URLs for web results.

${courseCode ? `Current course context: ${courseCode} (UBCO). Do not ask the user for the course code if it's provided.` : ''}

Be helpful, conversational, and accurate. Use markdown for formatting.`,
      };
    }

    // Stream the response
    console.log(`Using ${supportsTools ? 'tool calling' : 'hybrid RAG'} approach for model: ${model}`);
    const result = await streamText(streamConfig);

    if (streaming) {
      return result.toDataStreamResponse({
        headers: {
          'Content-Encoding': 'none',
          'Transfer-Encoding': 'chunked',
          'Connection': 'keep-alive'
        }
      });
    } else {
      // Return a regular JSON response instead of streaming
      try {
        // Ensure all streaming/tool steps complete
        await result.consumeStream();

        const [text, usage, finishReason, sources, reasoning, response] = await Promise.all([
          result.text,
          result.usage,
          result.finishReason,
          result.sources,
          result.reasoning,
          result.response,
        ]);

        return new Response(
          JSON.stringify({
            content: text,
            model: model,
            usage: usage,
            finishReason: finishReason,
            sources: sources || [],
            reasoning: reasoning,
            responseId: response?.id,
            courseCode: courseCode,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      } catch (error) {
        console.error('Error in non-streaming response:', error);
        return new Response(
          JSON.stringify({
            error: "Failed to generate non-streaming response",
            details: error instanceof Error ? error.message : "Unknown error",
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
