import { streamText, tool } from "ai";
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

                            // Check if model is Ollama - many models don't support tool calling reliably
    const isOllamaModel = model.startsWith('ollama:');

    let streamConfig;

    if (isOllamaModel) {
      // OLLAMA MODELS: Use hybrid RAG approach due to tool calling compatibility issues
      // Research shows most Ollama models struggle with tool calling + streaming

      // Get the last user message to check if RAG might be needed
      const lastMessage = messages[messages.length - 1];
      const messageContent = typeof lastMessage?.content === 'string'
        ? lastMessage.content.toLowerCase()
        : '';

      // Detect if user is asking about course content
      const isRAGQuery = courseId && (
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
          const relevantContent = await findRelevantContent(messageContent, courseId);
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
            system: `You are EduAI, a helpful AI assistant for course content.

${contextText ? `Here are relevant excerpts from the course materials to help answer the user's question:

${contextText}

Based on this information, provide a comprehensive answer to the user's question. If the provided content doesn't fully answer their question, mention what you can answer based on the available materials and suggest what additional information might be helpful.` : 'I don\'t have access to specific course materials for this question, but I can provide general educational assistance.'}

Always be helpful, accurate, and cite the course materials when using them in your response.`,
          };
        } catch (error) {
          console.error('Error finding relevant content for Ollama:', error);
          streamConfig = {
            model: aiModel,
            messages,
            temperature: 0.6,
            maxTokens: 8192,
            system: 'You are EduAI, a helpful AI assistant. I can help with general questions and educational topics.',
          };
        }
      } else {
        // General conversation without RAG
        streamConfig = {
          model: aiModel,
          messages,
          temperature: 0.6,
          maxTokens: 8192,
          system: 'You are EduAI, a helpful AI assistant. You can help with general questions, explanations, and educational topics.',
        };
      }
    } else {
      // CLOUD MODELS: Use full tool calling functionality
      streamConfig = {
        model: aiModel,
        messages,
        temperature: 0.6,
        maxTokens: 32000,
        maxSteps: 5,
        tools,
        toolCallStreaming: true, // Works reliably with cloud models
        system: `You are EduAI, a helpful AI assistant for course content.

When users ask questions about course materials, use the getInformation tool to search through the uploaded course materials and provide accurate answers based on that content.

Always be helpful and accurate. If you don't have relevant information from the course materials, say so clearly.`,
      };
    }

    // Stream the response
    console.log(`Using ${isOllamaModel ? 'hybrid RAG' : 'tool calling'} approach for model: ${model}`);
    const result = await streamText(streamConfig);

    return result.toDataStreamResponse({
      headers: {
        'Content-Encoding': 'none',
        'Transfer-Encoding': 'chunked',
        'Connection': 'keep-alive'
      }
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
