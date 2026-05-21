import type { Prisma, User } from "@prisma/client";
import { UserRole } from "@prisma/client";
import { randomUUID } from "crypto";
import { APICallError, streamText, tool } from "ai";
import { createAIProviderRegistry, modelSupportsTools } from "~/lib/ai/providers";
import { findRelevantContent } from "~/lib/ai/embedding";
import { runTool, toolError } from "~/lib/ai/tool-result";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import { auth } from "~/lib/auth/server";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { webSearch, fetchPage } from "~/lib/ai/tools";
import prisma from "~/lib/prisma.server";

const MAX_CONTEXT_MESSAGES = 20;

function chatApiDebug(message: string, payload?: Record<string, unknown>): void {
  if (process.env.CHAT_API_DEBUG !== "1") return;
  if (payload === undefined) {
    console.debug(`[chat-api] ${message}`);
  } else {
    console.debug(`[chat-api] ${message}`, payload);
  }
}

/** Max chars of upstream error body embedded in the data-stream error frame for the UI. */
const MAX_STREAM_ERROR_CLIENT_CHARS = 900;

function formatChatStreamError(error: unknown): string {
  if (APICallError.isInstance(error)) {
    const parts: string[] = [error.message];
    if (error.statusCode != null) {
      parts.push(`HTTP ${error.statusCode}`);
    }
    const body = error.responseBody?.trim();
    if (body) {
      const slice =
        body.length > MAX_STREAM_ERROR_CLIENT_CHARS
          ? `${body.slice(0, MAX_STREAM_ERROR_CLIENT_CHARS)}…`
          : body;
      parts.push(slice);
    }
    return parts.join(" — ");
  }
  if (error instanceof Error) {
    return error.message.length > MAX_STREAM_ERROR_CLIENT_CHARS
      ? `${error.message.slice(0, MAX_STREAM_ERROR_CLIENT_CHARS)}…`
      : error.message;
  }
  return "Unknown error";
}

/**
 * Hybrid RAG + `getInformation` excerpt limits. Defaults favour richer course
 * context for multi-turn student use; override via env if you hit token limits.
 *
 * - `CHAT_HYBRID_RAG_MAX_CHUNKS` — max vector hits merged into context (1–24).
 * - `CHAT_HYBRID_RAG_MAX_CONTEXT_CHARS` — total char budget for hybrid system injection.
 * - `CHAT_TOOL_RAG_MAX_CHARS_PER_CHUNK` — per-chunk cap on the tool payload.
 */
const HYBRID_RAG_MAX_CHUNKS = Math.min(
  24,
  Math.max(1, Number(process.env.CHAT_HYBRID_RAG_MAX_CHUNKS) || 8),
);
const HYBRID_RAG_MAX_CONTEXT_CHARS = Math.min(
  100_000,
  Math.max(2_000, Number(process.env.CHAT_HYBRID_RAG_MAX_CONTEXT_CHARS) || 28_000),
);
const TOOL_RAG_MAX_CHARS_PER_CHUNK = Math.min(
  50_000,
  Math.max(500, Number(process.env.CHAT_TOOL_RAG_MAX_CHARS_PER_CHUNK) || 10_000),
);

/**
 * Max LLM round-trips per user turn for tool-capable models.
 *
 * Each step is either a tool call or a final-text generation. Higher caps let
 * the model speculatively pre-roll tool calls (RAG -> webSearch -> fetchPage ->
 * fetchPage -> ...) before any user-visible text, which is the dominant source
 * of first-message silence (~6-9 s of "EduAI is thinking..."). 3 is enough for
 * one RAG hop + one optional web hop + the answer.
 *
 * Override via `CHAT_TOOL_MAX_STEPS` env var if needed.
 */
const TOOL_MAX_STEPS = Math.min(
  32,
  Math.max(1, Number(process.env.CHAT_TOOL_MAX_STEPS) || 3),
);
const TOOL_MAX_TOKENS = Math.min(
  128_000,
  Math.max(1024, Number(process.env.CHAT_TOOL_MAX_OUTPUT_TOKENS) || 32_000),
);

/**
 * HTTP-level retries inside `streamText` for transient provider errors.
 * AI SDK default is 2 → up to **3** outbound `generateContent` attempts per user send.
 * On Gemini **free tier**, quota errors (429) are not fixed by retrying — each attempt
 * still counts against `generate_content_free_tier_requests`. Set `CHAT_LLM_MAX_RETRIES=0`
 * in `.env` during local dev to avoid burning 3× quota per click. Production often keeps 1–2.
 */
const CHAT_LLM_MAX_RETRIES = (() => {
  const raw = process.env.CHAT_LLM_MAX_RETRIES;
  if (raw === undefined || raw === "") return 2;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 2;
  return Math.min(4, Math.max(0, Math.floor(n)));
})();

type GenericMessage = Record<string, any>;

function llmPromptSizeHints(system: string | undefined, messages: GenericMessage[]) {
  return {
    systemChars: system?.length ?? 0,
    messageCount: messages.length,
    messagesCharsApprox: messages.reduce((acc, m) => acc + JSON.stringify(m).length, 0),
  };
}

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
    if (room > 120) {
      parts.push(`${header}${body.slice(0, room)}…`);
    }
    break;
  }

  return parts.join(sep);
}

/** Shrink tool payloads so a single `getInformation` call cannot flood the next model step. */
function capRagHitsForTool(hits: HybridRagHit[]): HybridRagHit[] {
  const out: HybridRagHit[] = [];
  let totalChars = 0;
  for (const hit of hits) {
    let content = hit.content;
    if (content.length > TOOL_RAG_MAX_CHARS_PER_CHUNK) {
      content = `${content.slice(0, TOOL_RAG_MAX_CHARS_PER_CHUNK)}…`;
    }
    if (totalChars + content.length > HYBRID_RAG_MAX_CONTEXT_CHARS) {
      break;
    }
    out.push({ ...hit, content });
    totalChars += content.length;
  }
  return out;
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

function serializeMessage(message: GenericMessage): Prisma.JsonValue {
  return JSON.parse(JSON.stringify(message)) as Prisma.JsonValue;
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
  // Fire-and-forget: warms up provider TCP+TLS on the first request.
  // Dynamic import keeps this .server module out of the client bundle.
  // Node module cache ensures it runs only once.
  import("~/lib/ai/warmup.server").catch(() => {});

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

    // Resolve course code -> internal id, and look up the chat, in parallel.
    // These are independent reads; serialising them was costing ~30-150 ms of
    // TTFT on every cold first message.
    const courseLookupPromise: Promise<{ id: string } | null> =
      courseCode && typeof courseCode === "string"
        ? prisma.course
            .findUnique({ where: { code: courseCode }, select: { id: true } })
            .catch((e) => {
              console.error("Failed to resolve course by code", e);
              return null;
            })
        : Promise.resolve(null);

    const chatLookupPromise = chatId
      ? prisma.chat.findFirst({
          where: { id: chatId, userId: actingUser.id },
        })
      : Promise.resolve(null);

    const [resolvedCourse, lookedUpChat] = await Promise.all([
      courseLookupPromise,
      chatLookupPromise,
    ]);

    const resolvedCourseId: string | null = resolvedCourse?.id ?? null;
    const effectiveCourseId = resolvedCourseId || courseId || null;

    let chat = lookedUpChat;
    if (chatId && !chat) {
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

    console.log(`Retrieved ${storedMessages.length} messages from DB for chat ${chat.id}`);
    console.log(`Incoming ${normalizedIncomingMessages.length} new messages`);

    const mergedMessages = mergeMessages(storedMessages, normalizedIncomingMessages);
    const trimmedMessages =
      mergedMessages.length > MAX_CONTEXT_MESSAGES
        ? mergedMessages.slice(-MAX_CONTEXT_MESSAGES)
        : mergedMessages;

    console.log(`After merge: ${mergedMessages.length} messages, after trim: ${trimmedMessages.length} messages`);

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

    // Create AI provider registry with user's API keys
    const registry = createAIProviderRegistry(apiKeys as any);

    // Get the AI model from registry
    const aiModel = registry.languageModel(model);

    // Persist user turn(s) before streaming so a failed write never runs the LLM
    // on a message that was not saved (Canvas-scale durability over ~20–80 ms TTFT).
    try {
      await appendMessages(normalizedIncomingMessages);
    } catch (error) {
      console.error("Failed to persist incoming user message(s):", error);
      return new Response(
        JSON.stringify({
          error: "Failed to save your message. Please try again.",
          details: error instanceof Error ? error.message : "Unknown error",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }

    // Tools are ALWAYS registered. Their availability is reported per-call
    // through the structured ToolError envelope (see `lib/ai/tool-result.ts`)
    // rather than by hiding the tool from the model. Rationale:
    //
    //   - Per-tenant / per-deployment availability (Canvas integration) is a
    //     runtime concern, not a registration concern.
    //   - Upstream failures (rate-limit, timeout, outage) happen at scale and
    //     must produce a graceful follow-up, not a stuck UI.
    //   - The model is taught the envelope shape in the system prompt below.
    //
    // `getInformation` returns MISSING_CONFIG when no course is selected. The
    // model surfaces this to the user in plain language ("select a course
    // first") instead of silently failing or chaining tool calls.
    const getInformationTool = tool({
      description:
        "Search the user's currently-selected course materials (syllabi, lectures, assignments). " +
        "Returns a structured error if no course is selected in this session.",
      parameters: z.object({
        question: z
          .string()
          .describe("The user's question about course content"),
      }),
      execute: async ({ question }) =>
        runTool("getInformation", async () => {
          if (!effectiveCourseId) {
            return toolError(
              "MISSING_CONFIG",
              "No course is selected. Ask the user to pick a course from the dropdown above so I can search its materials.",
            );
          }
          try {
            const relevantContent = await findRelevantContent(
              question,
              effectiveCourseId,
              HYBRID_RAG_MAX_CHUNKS,
            );
            const capped = capRagHitsForTool(relevantContent);
            if (capped.length === 0) {
              return toolError(
                "NO_RESULTS",
                "No relevant excerpts were found in the course materials for that question. Rephrase or be more specific.",
              );
            }
            return {
              relevantContent: capped,
              count: capped.length,
            };
          } catch (error) {
            console.error("Error finding relevant content:", error);
            return toolError(
              "UNKNOWN",
              "Failed to search course materials. Try again in a moment.",
            );
          }
        }),
    });

    const tools = {
      getInformation: getInformationTool,
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

      const isRAGQuery =
        Boolean(effectiveCourseId) &&
        (
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
          messageContentLower.includes("about")
        );

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

You have access to the following tools, but most questions do NOT need them. Default to answering directly from your own knowledge and the conversation history.

Tools:
- getInformation: searches uploaded course materials (syllabi, lectures, assignments). Use ONLY when the user asks about the current course's materials.
- webSearch: searches the web. Use ONLY when the user explicitly asks for current events, recent reviews/opinions, or information you do not already know.
- fetchPage: opens a single URL the user already gave you (or one returned by webSearch). Use sparingly; at most one fetchPage per turn.

Tool-use rules:
1. Do NOT call any tool for greetings, definitions, conceptual explanations, summarisation of the conversation, or short clarifications. Answer directly.
2. Prefer ZERO tool calls. If a tool is genuinely needed, prefer ONE call total before answering.
3. Never chain tools speculatively. If a single tool result is insufficient, answer with what you have and tell the user what additional information would help.
4. When you DO use a tool, cite the source: course material title for getInformation; URL for webSearch / fetchPage.

HANDLING TOOL RESULTS:
Tools may return either a normal result OR a structured error of the form { "error": "<message>", "code": "<CODE>" }. When you see a tool result with an "error" field:
- DO NOT retry the same tool with the same inputs.
- Acknowledge the situation to the user in 1-2 plain-language sentences and offer a practical next step.
- Never pretend the tool does not exist; explain that it failed or is currently unavailable.

Common error codes:
- MISSING_CONFIG: the tool is not set up for this session (e.g. no course selected, or web access not enabled on this server). Tell the user concisely and suggest the obvious fix (e.g. "select a course from the dropdown" or "paste the content directly").
- RATE_LIMITED: temporarily over quota. Suggest trying again shortly; proceed with what you already know.
- NETWORK_ERROR / UPSTREAM_ERROR: the upstream service is unreachable. Suggest trying again later or a different source.
- NO_RESULTS: the search returned nothing useful. Answer from your own knowledge or ask the user to rephrase.
- INVALID_INPUT: the input you sent was unusable. Do not retry without different inputs.
- UNKNOWN: an unexpected failure. Apologise briefly and proceed with what you know.

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
    const result = await streamText({
      ...(streamConfig as Parameters<typeof streamText>[0]),
      maxRetries: CHAT_LLM_MAX_RETRIES,
      onError: ({ error }) => {
        console.error("[chat] streamText error:", error);
        if (APICallError.isInstance(error)) {
          console.error("[chat] upstream APICallError:", {
            statusCode: error.statusCode,
            url: error.url,
            responseBody: error.responseBody?.slice(0, 4000),
          });
        }
      },
    });

    if (streaming) {
      const headers: Record<string, string> = {
        "Content-Encoding": "none",
        "Transfer-Encoding": "chunked",
        Connection: "keep-alive",
      };
      if (chat?.id) {
        headers["X-Chat-Id"] = chat.id;
      }
      return result.toDataStreamResponse({
        headers,
        getErrorMessage: formatChatStreamError,
      });
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
