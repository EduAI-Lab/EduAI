import { streamText, tool, smoothStream } from "ai";
import { createAIProviderRegistry } from "~/lib/ai/providers";
import { findRelevantContent } from "~/lib/ai/embedding";
import { auth } from "~/lib/auth/server";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const session = await auth.api.getSession(request);
    if (!session?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { messages, model, apiKeys, courseId } = await request.json();

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

    // Define tools for RAG functionality
    const tools = {
      getInformation: tool({
        description:
          "Get information from the course materials to answer questions. Only use this when the user asks a question about course content.",
        parameters: z.object({
          question: z
            .string()
            .describe("The user's question about course content"),
        }),
        execute: async ({ question }) => {
          if (!courseId) {
            return { error: "No course selected for RAG search" };
          }

          try {
            const relevantContent = await findRelevantContent(
              question,
              courseId
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
    };

    // Stream the response with tools and multi-step calls
    const result = await streamText({
      model: aiModel,
      messages,
      experimental_transform: smoothStream(),
      temperature: 0.6,
      maxTokens: 32000,
      maxSteps: 5, // Allow up to 5 tool calls
      tools,
      system: `You are EduAI, a helpful AI assistant for course content.

When users ask questions about course materials, use the getInformation tool to search through the uploaded course materials and provide accurate answers based on that content.

Always be helpful and accurate. If you don't have relevant information from the course materials, say so clearly.`,

    });

    return result.toDataStreamResponse();
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
