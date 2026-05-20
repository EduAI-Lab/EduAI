import type { Prisma, User } from "@prisma/client";
import { UserRole } from "@prisma/client";
import { randomUUID } from "crypto";
import { streamText, tool } from "ai";
import { createAIProviderRegistry, modelSupportsTools } from "~/lib/ai/providers";
import { findRelevantContent } from "~/lib/ai/embedding";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import { auth } from "~/lib/auth/server";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { webSearch, fetchPage } from "~/lib/ai/tools";
import prisma from "~/lib/prisma.server";
import { chatApiDebug } from "~/lib/chat-api-log";
import { clientApiKeysBodySchema, toUserProviderSettings } from "~/lib/chat-api-keys.schema";

const MAX_CONTEXT_MESSAGES = 20;

/** Hybrid RAG + tool `getInformation`: pgvector row cap (default was 6). */
const HYBRID_RAG_MAX_CHUNKS = 4;
/** Max characters from excerpts injected into hybrid `system` (non-tool models). */
const HYBRID_RAG_MAX_CONTEXT_CHARS = 14_000;

/** Max characters per chunk returned to the model from `getInformation` (tool path). */
const TOOL_RAG_MAX_CHARS_PER_CHUNK = 6000;
/** Minimum remaining chars before truncating the last hybrid RAG excerpt. */
const HYBRID_RAG_MIN_TRUNCATE_CHARS = 120;

const TOOL_MAX_STEPS = Math.min(
  32,
  Math.max(1, Number(process.env.CHAT_TOOL_MAX_STEPS) || 12),
);
const TOOL_MAX_TOKENS = Math.min(
  128_000,
  Math.max(1024, Number(process.env.CHAT_TOOL_MAX_OUTPUT_TOKENS) || 32_000),
);

type GenericMessage = Record<string, any>;

type HybridRagHit = { content: string; similarity: number; materialTitle: string };

/** Top-similarity first; stops at chunk count and char budget for local LLM prefill. */
function buildCappedRagContextText(hits: HybridRagHit[], maxChunks: number, maxChars: number): string {
  const slice = hits.slice(0, maxChunks);
  const sep = "\n\n---\n\n";
  const parts: string[] = [];
  let total = 0;

  for (const item of slice) {
    const header = `**Source**: ${item.materialTitle || "Course Material"}\n`;
    const body = item.content;
    const overhead = parts.length === 0 ? 0 : sep.length;
    const fullLen = header.length + body.length;

    if (total + overhead + fullLen <= maxChars) {
      parts.push(header + body);
      total += overhead + fullLen;
      continue;
    }

    const room = maxChars - total - overhead - header.length;
    if (room > HYBRID_RAG_MIN_TRUNCATE_CHARS) {
      parts.push(`${header}${body.slice(0, room)}…`);
    }
    break;
  }

  return parts.join(sep);
}

/** Shrink tool payloads so a single `getInformation` call cannot flood the next model step. */
function capRagHitsForTool(hits: HybridRagHit[]): HybridRagHit[] {
  return hits.slice(0, HYBRID_RAG_MAX_CHUNKS).map((h) => ({
    ...h,
    content:
      h.content.length > TOOL_RAG_MAX_CHARS_PER_CHUNK
        ? `${h.content.slice(0, TOOL_RAG_MAX_CHARS_PER_CHUNK)}…`
        : h.content,
  }));
}

type StoredMessageRecord = {
  messageId: string;
  role: string;
  content: Prisma.JsonValue;
};

type ProxyUserPayload = {
  provider?: string;
  id?: string;
  email?: string;
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Normalizes arbitrary incoming message payloads so downstream code can rely on
 * `id` and `role` being present. If a client omits `id`, we stamp one here so
 * the message can still be persisted and deduplicated.
 *
 * NOTE: Clients SHOULD generate a UUID v4 for every message (`message.id`) before
 * sending it. This enables optimistic UI updates and allows the server to
 * deduplicate retries safely.
 */
function normalizeMessage(message: unknown): GenericMessage | null {
  if (!message || typeof message !== "object") {
    return null;
  }

  const normalized = { ...(message as GenericMessage) };
  if (!isNonEmptyString(normalized.role)) {
    return null;
  }

  if (!isNonEmptyString(normalized.id)) {
    normalized.id = randomUUID();
  }

  return normalized;
}

/**
 * Rehydrates a stored DB record back into the AI SDK-friendly envelope. The DB
 * always stores the original JSON, but `messageId`/`role` are kept separately as
 * an escape hatch if the payload ever changes shape.
 */
function reviveStoredMessage(record: StoredMessageRecord): GenericMessage {
  if (record.content && typeof record.content === "object") {
    const parsed = record.content as GenericMessage;
    const id = isNonEmptyString(parsed.id) ? parsed.id : record.messageId;
    const role = isNonEmptyString(parsed.role) ? parsed.role : record.role;
    return { ...parsed, id, role };
  }

  return {
    id: record.messageId,
    role: record.role,
    content: "",
  };
}

/**
 * Appends previously unseen messages (by `id`) to the stored history slice.
 * This lets clients resend the latest user turn without worrying about the
 * server duplicating history.
 */
function mergeMessages(stored: GenericMessage[], incoming: GenericMessage[]): GenericMessage[] {
  if (incoming.length === 0) {
    return stored;
  }

  const seenIds = new Set(
    stored
      .map((message) => (isNonEmptyString(message.id) ? message.id : null))
      .filter(isNonEmptyString),
  );

  const merged = [...stored];

  for (const message of incoming) {
    if (!isNonEmptyString(message.id)) {
      continue;
    }
    if (seenIds.has(message.id)) {
      continue;
    }
    merged.push(message);
    seenIds.add(message.id);
  }

  return merged;
}

/**
 * Produces a best-effort string representation of a message. We only need this
 * for lightweight keyword checks when deciding whether to run manual RAG.
 */
function extractTextFromMessage(message?: GenericMessage): string {
  if (typeof message?.content === "string") {
    return message.content;
  }

  if (Array.isArray(message?.content)) {
    return message!.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part && typeof (part as any).text === "string") {
          return (part as any).text;
        }
        return "";
      })
      .filter(isNonEmptyString)
      .join(" ");
  }

  if (message?.content && typeof message.content === "object" && "text" in (message.content as any)) {
    const candidate = (message.content as { text?: string }).text;
    if (typeof candidate === "string") {
      return candidate;
    }
  }

  return message ? JSON.stringify(message.content ?? "") : "";
}

/** Cheap metrics for logs — do not print full `system` / messages (RAG can be huge). */
function llmPromptSizeHints(system: unknown, messages: GenericMessage[]) {
  const systemChars = typeof system === "string" ? system.length : 0;
  let messageTextChars = 0;
  for (const m of messages) {
    messageTextChars += extractTextFromMessage(m).length;
  }
  return {
    systemChars,
    messageCount: messages.length,
    messageTextChars,
  };
}

/** Serializes a message object to JSON, handling circular references. */
function serializeMessage(message: GenericMessage): Prisma.JsonValue {
  try {
    return structuredClone(message) as Prisma.JsonValue;
  } catch {
    return JSON.parse(JSON.stringify(message)) as Prisma.JsonValue;
  }
}

/**
 * Maps an external `(provider, id)` pair to an EduAI user, creating the user +
 * `ExternalUser` record when needed. The canonical EduAI email stays unchanged;
 * we only update the mapping's email for reference.
 */
async function resolveProxyUser(proxyUser: ProxyUserPayload): Promise<User> {
  const provider = proxyUser.provider?.trim().toLowerCase() || "aitutor";
  const externalUserId = proxyUser.id?.trim();

  if (!externalUserId) {
    throw new Error("proxyUser.id is required");
  }

  let email = proxyUser.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    email = `${externalUserId}@${provider}.local`;
  }

  const existingMapping = await prisma.externalUser.findUnique({
    where: {
      provider_externalUserId: {
        provider,
        externalUserId,
      },
    },
    include: {
      user: true,
    },
  });

  if (existingMapping?.user) {
    if (!existingMapping.email && email) {
      await prisma.externalUser.update({
        where: { id: existingMapping.id },
        data: { email },
      });
    }
    return existingMapping.user;
  }

  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: email,
        role: UserRole.STUDENT,
        isActive: true,
      },
    });
  }

  try {
    await prisma.externalUser.create({
      data: {
        provider,
        externalUserId,
        email,
        userId: user.id,
      },
    });
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      const mapping = await prisma.externalUser.findUnique({
        where: {
          provider_externalUserId: {
            provider,
            externalUserId,
          },
        },
        include: { user: true },
      });
      if (mapping?.user) {
        return mapping.user;
      }
    }
    throw error;
  }

  return user;
}

/**
 * POST /api/chat
 *
 * Accepts the latest chat turns, reconstructs server-side history, optionally
 * applies proxy delegation, and returns either a streaming response or a
 * regular JSON payload. Message persistence happens automatically so clients no
 * longer need to resend the full transcript.
 *
 * NOTE:
 * - Chat IDs are strictly server-generated (CUID).
 * - Message IDs should be client-generated (UUID v4) for best results.
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const apiKeyHeader = request.headers.get("x-api-key");
    const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
    if (apiKeyGuard) return apiKeyGuard;

    const session = apiKeySession ?? (await auth.api.getSession(request));
    if (!session?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await request.json();
    const rawMessages: unknown[] = Array.isArray(body.messages) ? body.messages : [];
    const model = typeof body.model === "string" ? body.model : undefined;
    const apiKeys = body.apiKeys as unknown;
    const courseId = typeof body.courseId === "string" ? body.courseId : undefined;
    const courseCode = typeof body.courseCode === "string" ? body.courseCode : undefined;
    const streaming = body.streaming === undefined ? true : Boolean(body.streaming);
    const chatId = typeof body.chatId === "string" ? body.chatId : undefined;
    const proxyUserPayload =
      body.proxyUser && typeof body.proxyUser === "object" ? (body.proxyUser as ProxyUserPayload) : null;

    const hasSystemPromptField = Object.prototype.hasOwnProperty.call(body, "systemPrompt");
    let trimmedSystemPrompt: string | null = null;
    if (typeof body.systemPrompt === "string") {
      const candidate = body.systemPrompt.trim();
      trimmedSystemPrompt = candidate.length > 0 ? candidate : null;
    } else if (body.systemPrompt === null) {
      trimmedSystemPrompt = null;
    }

    let actingUser = session.user;
    if (proxyUserPayload) {
      if (!apiKeyHeader) {
        return new Response(JSON.stringify({ error: "proxyUser requires admin API key access" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const proxyUser = await resolveProxyUser(proxyUserPayload);
        actingUser = {
          ...actingUser,
          id: proxyUser.id,
          email: proxyUser.email,
          name: proxyUser.name,
          role: proxyUser.role,
        };
      } catch (error) {
        console.error("Failed to resolve proxy user:", error);
        return new Response(
          JSON.stringify({
            error: "Failed to resolve proxy user",
            details: error instanceof Error ? error.message : "Unknown error",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    const normalizedIncomingMessages = rawMessages
      .map((m) => normalizeMessage(m))
      .filter((m): m is GenericMessage => m !== null);

    // Resolve course code to internal ID when needed
    let resolvedCourseId: string | null = null;
    if (courseCode && typeof courseCode === "string") {
      try {
        const course = await prisma.course.findUnique({ where: { code: courseCode } });
        resolvedCourseId = course?.id || null;
      } catch (e) {
        console.error("Failed to resolve course by code", e);
      }
    }
    const effectiveCourseId = resolvedCourseId || courseId || null;

    // Handle chat lookup and system prompt persistence
    let chat = null;
    if (chatId) {
      chat = await prisma.chat.findFirst({
        where: { id: chatId, userId: actingUser.id },
      });
      if (!chat) {
        return new Response(
          JSON.stringify({
            error: "Chat not found",
            chatDeleted: true,
          }),
          {
            status: 410,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }

    if (hasSystemPromptField) {
      if (chat) {
        if (chat.systemPrompt !== trimmedSystemPrompt) {
          chat = await prisma.chat.update({
            where: { id: chat.id },
            data: { systemPrompt: trimmedSystemPrompt },
          });
        }
      } else if (trimmedSystemPrompt) {
        chat = await prisma.chat.create({
          data: {
            userId: actingUser.id,
            systemPrompt: trimmedSystemPrompt,
          },
        });
      }
    }

    const shouldCreateChat = normalizedIncomingMessages.length > 0 || Boolean(trimmedSystemPrompt);

    if (!chat && !shouldCreateChat) {
      return new Response(
        JSON.stringify({
          chatId: null,
          systemPrompt: trimmedSystemPrompt ?? null,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (!chat && shouldCreateChat) {
      chat = await prisma.chat.create({
        data: {
          userId: actingUser.id,
          systemPrompt: trimmedSystemPrompt,
        },
      });
    }

    if (!chat) {
      return new Response(JSON.stringify({ error: "Unable to resolve chat context" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch only the slice of history we plan to send back to the LLM.
    const recentMessageRecords = await prisma.chatMessage.findMany({
      where: { chatId: chat.id },
      orderBy: { position: "desc" },
      take: MAX_CONTEXT_MESSAGES,
    });

    const storedMessages = recentMessageRecords.reverse().map((record) =>
      reviveStoredMessage({
        messageId: record.messageId,
        role: record.role,
        content: record.content,
      }),
    );

    chatApiDebug("chat history loaded", {
      chatId: chat.id,
      storedCount: storedMessages.length,
      incomingCount: normalizedIncomingMessages.length,
    });

    const mergedMessages = mergeMessages(storedMessages, normalizedIncomingMessages);
    const trimmedMessages =
      mergedMessages.length > MAX_CONTEXT_MESSAGES
        ? mergedMessages.slice(-MAX_CONTEXT_MESSAGES)
        : mergedMessages;

    chatApiDebug("chat history merged", {
      mergedCount: mergedMessages.length,
      trimmedCount: trimmedMessages.length,
    });

    if (mergedMessages.length === 0) {
      return new Response(
        JSON.stringify({
          chatId: chat?.id ?? null,
          systemPrompt: trimmedSystemPrompt ?? chat?.systemPrompt ?? null,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (!model || typeof apiKeys !== "object" || apiKeys === null) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Validate API keys
    const apiKeysParsed = clientApiKeysBodySchema.safeParse(apiKeys);
    if (!apiKeysParsed.success) {
      return new Response(
        JSON.stringify({
          error: "Invalid apiKeys",
          details: apiKeysParsed.error.flatten(),
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    const validatedApiKeys = toUserProviderSettings(apiKeysParsed.data);

    const existingMessageIds = new Set(storedMessages.map((message) => message.id).filter(isNonEmptyString));
    const appendMessages = async (messages: GenericMessage[]) => {
      if (!messages.length) return;

      const rows: Prisma.ChatMessageCreateManyInput[] = [];

      for (const message of messages) {
        if (!isNonEmptyString(message.role) || !isNonEmptyString(message.id)) {
          continue;
        }

        if (existingMessageIds.has(message.id)) {
          continue;
        }

        rows.push({
          chatId: chat!.id,
          messageId: message.id,
          role: message.role,
          content: serializeMessage(message) as Prisma.InputJsonValue,
        });

        existingMessageIds.add(message.id);
      }

      if (rows.length > 0) {
        await prisma.chatMessage.createMany({
          data: rows,
          skipDuplicates: true,
        });
      }
    };

    const registry = createAIProviderRegistry(validatedApiKeys);

    // Get the AI model from registry
    const aiModel = registry.languageModel(model);

    await appendMessages(normalizedIncomingMessages);

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

    // Check if the model supports tool calling
    const supportsTools = await modelSupportsTools(model);

    let streamConfig;

    const resolvedSystemPrompt = trimmedSystemPrompt ?? chat.systemPrompt ?? null;

    if (!supportsTools) {
      // MODELS WITHOUT TOOL SUPPORT: Use hybrid RAG approach
      const lastUserMessage = [...trimmedMessages].reverse().find((message) => message.role === "user");
      const userQuestion = extractTextFromMessage(lastUserMessage);
      const messageContentLower = userQuestion.toLowerCase();

      // Check if hybrid RAG should always be used with course
      // regex method might not be the best method to determine if RAG is needed. Consider using a small LLM or alternatives.
      const hybridRagAlwaysWithCourse = process.env.CHAT_HYBRID_RAG_ALWAYS_WITH_COURSE === "1";
      const isRAGQuery =
        Boolean(effectiveCourseId) &&
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
            effectiveCourseId!,
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

          const baseSystemPrompt = resolvedSystemPrompt || `You are EduAI, a helpful AI assistant for students and faculty at UBC Okanagan (UBCO).

IMPORTANT: You have access to the full conversation history in the messages array. When users ask about previous messages or context, refer to the conversation history provided to you. DO NOT claim you cannot remember past messages.

${courseCode ? `Current course context: ${courseCode} (UBCO). Do not ask the user for the course code if it's provided.` : ``}

Always be helpful, accurate, and cite the course materials when using them in your response. Use markdown for formatting.`;

          const systemWithRAG = contextText
            ? `${baseSystemPrompt}

${contextText ? `Here are relevant excerpts from the course materials to help answer the user's question:

${contextText}

Based on this information, provide a comprehensive answer to the user's question. If the provided content doesn't fully answer their question, mention what you can answer based on the available materials and suggest what additional information might be helpful.` : "I don't have access to specific course materials for this question, but I can provide general educational assistance."}`
            : baseSystemPrompt;

          streamConfig = {
            model: aiModel,
            messages: trimmedMessages,
            temperature: 0.6,
            maxTokens: 8192,
            system: systemWithRAG,
          };
        } catch (error) {
          console.error("Error finding relevant content for model without tool support:", error);
          const defaultSystemPrompt = resolvedSystemPrompt || `You are EduAI, a helpful AI assistant for students and faculty at UBC Okanagan (UBCO).

IMPORTANT: You have access to the full conversation history in the messages array. When users ask about previous messages or context, refer to the conversation history provided to you. DO NOT claim you cannot remember past messages.

${courseCode ? `Current course context: ${courseCode} (UBCO). Do not ask the user for the course code if it's provided.` : ""}

Be helpful, conversational, and accurate. Use markdown for formatting.`;

          streamConfig = {
            model: aiModel,
            messages: trimmedMessages,
            temperature: 0.6,
            maxTokens: 8192,
            system: defaultSystemPrompt,
          };
        }
      } else {
        const defaultSystemPrompt = resolvedSystemPrompt || `You are EduAI, a helpful AI assistant for students and faculty at UBC Okanagan (UBCO).

IMPORTANT: You have access to the full conversation history in the messages array. When users ask about previous messages or context, refer to the conversation history provided to you. DO NOT claim you cannot remember past messages.

${courseCode ? `Current course context: ${courseCode} (UBCO). Do not ask the user for the course code if it's provided.` : ""}

Be helpful, conversational, and accurate. Use markdown for formatting.`;

        streamConfig = {
          model: aiModel,
          messages: trimmedMessages,
          temperature: 0.6,
          maxTokens: 8192,
          system: defaultSystemPrompt,
        };
      }
    } else {
      const defaultSystemPrompt = resolvedSystemPrompt || `You are EduAI, a helpful AI assistant for students and faculty at UBC Okanagan (UBCO).

IMPORTANT: You have access to the full conversation history in the messages array. When users ask about previous messages or context, refer to the conversation history provided to you. DO NOT claim you cannot remember past messages.

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

${courseCode ? `Current course context: ${courseCode} (UBCO). Do not ask the user for the course code if it's provided.` : ""}

Be helpful, conversational, and accurate. Use markdown for formatting.`;

      streamConfig = {
        model: aiModel,
        messages: trimmedMessages,
        temperature: 0.6,
        maxTokens: TOOL_MAX_TOKENS,
        maxSteps: TOOL_MAX_STEPS,
        tools,
        toolCallStreaming: streaming,
        system: defaultSystemPrompt,
      };
    }

    // Log the LLM stream configuration
    chatApiDebug("Starting LLM stream", {
      model,
      approach: supportsTools ? "tool_calling" : "hybrid_rag",
      ...llmPromptSizeHints(streamConfig.system, trimmedMessages),
    });
    const result = await streamText(streamConfig as Parameters<typeof streamText>[0]);

    if (streaming) {
      const headers: Record<string, string> = {
        "Content-Encoding": "none",
        "Transfer-Encoding": "chunked",
        Connection: "keep-alive",
      };
      if (chat?.id) {
        headers["X-Chat-Id"] = chat.id;
      }
      return result.toDataStreamResponse({ headers });
    } else {
      try {
        await result.consumeStream();

        const [text, usage, finishReason, sources, reasoning, response] = await Promise.all([
          result.text,
          result.usage,
          result.finishReason,
          result.sources,
          result.reasoning,
          result.response,
        ]);

        if (response?.messages?.length) {
          const assistantMessages = response.messages.filter((message) => message.role === "assistant");
          await appendMessages(assistantMessages);
        } else if (text) {
          await appendMessages([
            {
              id: randomUUID(),
              role: "assistant",
              content: text,
            },
          ]);
        }

        return new Response(
          JSON.stringify({
            content: text,
            model,
            usage,
            finishReason,
            sources: sources || [],
            reasoning,
            responseId: response?.id,
            courseCode,
            chatId: chat?.id,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      } catch (error) {
        console.error("Error in non-streaming response:", error);
        return new Response(
          JSON.stringify({
            error: "Failed to generate non-streaming response",
            details: error instanceof Error ? error.message : "Unknown error",
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
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
