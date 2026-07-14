import type { Prisma, User } from "@prisma/client";
import { UserRole } from "@prisma/client";
import { randomUUID } from "crypto";
import { createDataStreamResponse, formatDataStreamPart, streamText } from "ai";
import {
  createAIProviderRegistry,
  listEnabledRegistryProviders,
  mergeLocalInferenceFromEnv,
  parseModelIdentifier,
} from "~/lib/ai/providers";
import {
  capMaxOutputTokensForPrompt,
  estimateTokensFromChars,
  getChatModelCapabilities,
  resolveActiveChatModel,
  resolveMaxOutputTokens,
  resolveModelContextWindow,
  ESTIMATED_CHARS_PER_TOKEN,
} from "~/lib/ai/providers.server";
import { resolveToolMaxOutputTokens } from "~/lib/ai/resolve-tool-max-tokens";
import { composeSystemPrompt, resolveEffectiveAdhdAssist } from "~/lib/ai/adhd-assist";
import { needsCourseRag } from "~/lib/ai/chat-intent";
import {
  buildChatToolRegistry,
  buildToolCallingSystemPrompt,
} from "~/lib/ai/chat-tools";
import {
  composeSecurityPrompt,
  filterIncomingClientMessages,
  sanitizeSystemPrompt,
} from "~/lib/ai/prompt-safety";
import {
  getProfileRequirements,
  resolveAdhdTurnProfile,
  type AdhdTurnProfile,
} from "~/lib/ai/adhd-turn-profile";
import {
  auditAndMaybeRewrite,
  buildOverseenAssistantMessagesToPersist,
  emptyOversightAuditResult,
  isAdhdOversightEnabled,
  type OversightMethod,
} from "~/lib/ai/adhd-oversight";
import { resolveAdhdResponseWordCap, isProfileStructuralPass, computeAdhdResponseMetrics } from "~/lib/ai/adhd-metrics";
import { recordResponseComplianceEvent } from "~/lib/assistive-events.server";
import { findRelevantContent } from "~/lib/ai/embedding";
import {
  resolveCourseAccessWithCourse,
  type AccessLevel,
} from "~/lib/auth/course-access.server";
import { enforceAdminIfApiKey, requireServiceKey } from "~/lib/auth/guards.server";
import { auth } from "~/lib/auth/server";
import type { ActionFunctionArgs } from "react-router";
import {
  buildAdminSystemPrompt,
  chatbotTypeFromMode,
  createChatTools,
  parseChatMode,
} from "~/lib/agent-tools";
import prisma from "~/lib/prisma.server";
import { chatApiDebug, chatApiReject, chatApiTrace } from "~/lib/chat-api-log";
import { clientApiKeysBodySchema, toUserProviderSettings } from "~/lib/chat-api-keys.schema";
import { getPolicy } from "~/lib/policy.server";
import {
  shouldInjectCourseRag,
  shouldPrefetchCourseRag,
} from "~/lib/ai/course-rag-policy";
import {
  buildCappedRagContextText,
  buildEmptyCourseRagBlock,
  buildRagSystemBlock,
  capToolResultsInMessages,
  estimateMessageCharsForModel,
  extractMessageText,
  LATEST_TURN_FOCUS_INSTRUCTION,
  prepareBoundedSessionContext,
  resolveMaxContextMessages,
  HYBRID_RAG_MAX_CHUNKS,
  HYBRID_RAG_MAX_CONTEXT_CHARS,
  type HybridRagHit,
} from "~/lib/chat-rag";

const TOOL_MAX_STEPS = Math.min(
  32,
  Math.max(1, Number(process.env.CHAT_TOOL_MAX_STEPS) || 12),
);
type GenericMessage = Record<string, any>;

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

/** Cheap metrics for logs — do not print full `system` / messages (RAG can be huge). */
function llmPromptSizeHints(system: unknown, messages: GenericMessage[]) {
  const systemChars = typeof system === "string" ? system.length : 0;
  let messageTextChars = 0;
  for (const m of messages) {
    // Count what the model actually receives (incl. tool-call/result payloads),
    // so this metric is not under-reported on tool-heavy turns (#260).
    messageTextChars += estimateMessageCharsForModel(m);
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
 * Pulls plain text out of AI-SDK `response.messages` (whose `content` is an
 * array of typed parts) as a fallback for when the `onFinish`/awaited `text`
 * field is empty. Keeps persisted assistant content as a string so chat history
 * restore renders real markdown instead of a blank bubble or raw JSON.
 */
function extractAssistantText(messages: GenericMessage[] | undefined): string {
  if (!messages?.length) return "";
  const collectText = (content: unknown): string => {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((p): p is GenericMessage => !!p && typeof p === "object")
        .filter((p) => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text as string)
        .join("\n");
    }
    return "";
  };
  return messages
    .filter((m) => m.role === "assistant")
    .map((m) => collectText(m.content))
    .filter((t) => t.length > 0)
    .join("\n");
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

function formatStreamError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message || error.name;
    if (message.includes("Invalid arguments for tool")) {
      return `${message} — The model passed invalid tool parameters. Retry or pick a tool-capable model (e.g. vllm:qwen2.5-32b-instruct).`;
    }
    return message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown stream error";
  }
}

function logStreamError(error: unknown, trace: Record<string, unknown>): void {
  console.error("[chat-api] stream error", {
    error: formatStreamError(error),
    trace,
    raw: error,
  });
}

function isClientAbort(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  return error instanceof Error && error.name === "AbortError";
}

/** Empty response when the client cancelled (e.g. stop button / fetch abort). */
function clientAbortResponse(): Response {
  return new Response(null, { status: 499 });
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

    let session = apiKeySession ?? (await auth.api.getSession({ headers: request.headers }));
    let isServiceKeyCaller = false;
    if (!session?.user) {
      const serviceKeyError = await requireServiceKey(request);
      if (serviceKeyError) return serviceKeyError;
      isServiceKeyCaller = true;
      session = { user: { id: "service", name: "Service", role: "ADMIN" } } as unknown as typeof session;
    }

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
    const forceHybridRag = body.forceHybridRag === true;
    const chatId = typeof body.chatId === "string" ? body.chatId : undefined;
    const chatMode = parseChatMode(body.chatMode);
    const expectedChatbotType = chatbotTypeFromMode(chatMode);

    chatApiTrace("request received", {
      chatMode,
      chatbotType: expectedChatbotType,
      chatId: chatId ?? null,
      model: model ?? null,
      courseCode: courseCode ?? null,
      courseId: courseId ?? null,
      messageCount: rawMessages.length,
      streaming,
      userId: session.user.id,
      userRole: session.user.role,
    });
    const proxyUserPayload =
      body.proxyUser && typeof body.proxyUser === "object" ? (body.proxyUser as ProxyUserPayload) : null;

    const hasAdhdAssistField = Object.prototype.hasOwnProperty.call(body, "adhdAssist");
    const adhdAssist = body.adhdAssist === true;

    const hasSystemPromptField = Object.prototype.hasOwnProperty.call(body, "systemPrompt");
    let trimmedSystemPrompt: string | null = null;
    if (typeof body.systemPrompt === "string") {
      trimmedSystemPrompt = sanitizeSystemPrompt(body.systemPrompt);
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
        return chatApiReject(
          400,
          {
            error: "Failed to resolve proxy user",
            details: error instanceof Error ? error.message : "Unknown error",
          },
          { chatMode, userId: actingUser.id },
        );
      }
    }

    if (
      chatMode === "admin" &&
      (isServiceKeyCaller || actingUser.role !== UserRole.ADMIN)
    ) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    const normalizedIncomingMessages = filterIncomingClientMessages(
      rawMessages
        .map((m) => normalizeMessage(m))
        .filter((m): m is GenericMessage => m !== null),
    );

    // Resolve course code to internal ID when needed
    let resolvedCourseId: string | null = null;
    if (courseCode && typeof courseCode === "string") {
      try {
        const course = await prisma.course.findFirst({ where: { code: courseCode, deletedAt: null } });
        resolvedCourseId = course?.id || null;
      } catch (e) {
        console.error("Failed to resolve course by code", e);
      }
    }
    // Load the owned chat up front so a follow-up turn that sends a `chatId`
    // but no `courseId`/`courseCode` can inherit the course from the persisted
    // chat row, instead of failing COURSE_REQUIRED below (#685 review).
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
      if (chat.chatbotType && chat.chatbotType !== expectedChatbotType) {
        return new Response(
          JSON.stringify({
            error: "Chatbot type mismatch",
            chatDeleted: true,
          }),
          {
            status: 410,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }

    // A persisted chat is pinned to its course. If a follow-up turn explicitly
    // names a *different* course, reject — silently switching would split the
    // chat's RAG context and message history across courses (#685 review).
    const requestedCourseId = resolvedCourseId || courseId || null;
    if (chat?.courseId && requestedCourseId && requestedCourseId !== chat.courseId) {
      return new Response(JSON.stringify({ error: "COURSE_MISMATCH" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }

    const effectiveCourseId = resolvedCourseId || courseId || chat?.courseId || null;

    // #657: the global "general assistant" chat was removed — every interactive
    // chat is now course-scoped. Server-to-server callers (admin API key /
    // ai-tutor proxy) and platform admins in admin chatMode may still omit a course.
    const isApiKeyCaller = isServiceKeyCaller;
    if (!effectiveCourseId && !isApiKeyCaller && chatMode !== "admin") {
      return new Response(JSON.stringify({ error: "COURSE_REQUIRED" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    let effectiveCourseCode = courseCode ?? null;
    if (!effectiveCourseCode && effectiveCourseId) {
      try {
        const course = await prisma.course.findUnique({
          where: { id: effectiveCourseId },
          select: { code: true },
        });
        effectiveCourseCode = course?.code ?? null;
      } catch (e) {
        console.error("Failed to resolve course code by id", e);
      }
    }

    // §10 (#302): course-scoped chats require course access for the acting
    // user. Students need an active enrollment AND a published course; an
    // inactive enrollment blocks new chats but never own-history reads
    // (GET /api/chats/:chatId is ownership-scoped and unaffected).
    // Hoisted so the web-tools gate (below) can read the caller's course access
    // level — null for general (non-course) chats.
    let courseAccess: AccessLevel | null = null;
    if (effectiveCourseId) {
      const { course, access } = await resolveCourseAccessWithCourse(
        actingUser,
        effectiveCourseId,
      );
      if (!course) {
        return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (!access || (access.level === "student" && !course.isPublished)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
      courseAccess = access;
    }

    // §839: students must not see materials that are hidden or scheduled for a
    // future reveal — exclude them from RAG retrieval. Staff (and service/admin
    // callers, whose level is never "student") retrieve everything.
    const restrictRagToStudentVisible = courseAccess?.level === "student";

    // Service-key (server-to-server) callers — e.g. the Question Maker proxy —
    // are stateless and have no real User row, so persisting a Chat would violate
    // chats_userId_fkey (P2003). Skip all chat/message persistence for them and
    // run the model against the incoming messages only.
    const ephemeral = isServiceKeyCaller;

    // Persist any system-prompt change onto the chat loaded above.
    if (hasSystemPromptField && !ephemeral) {
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
            chatbotType: expectedChatbotType,
            courseId: effectiveCourseId,
            systemPrompt: trimmedSystemPrompt,
            adhdAssist,
          },
        });
      }
    }

    // Backfill course context onto an existing chat that was created before a
    // course was selected (e.g. user picked the course mid-conversation).
    if (!ephemeral && chat && effectiveCourseId && chat.courseId !== effectiveCourseId && !chat.courseId) {
      chat = await prisma.chat.update({
        where: { id: chat.id },
        data: { courseId: effectiveCourseId },
      });
    }

    if (!ephemeral && hasAdhdAssistField && chat && chat.adhdAssist !== adhdAssist) {
      chat = await prisma.chat.update({
        where: { id: chat.id },
        data: { adhdAssist },
      });
    }

    const shouldCreateChat = normalizedIncomingMessages.length > 0 || Boolean(trimmedSystemPrompt);

    if (!chat && !shouldCreateChat) {
      return new Response(
        JSON.stringify({
          chatId: null,
          systemPrompt: trimmedSystemPrompt ?? null,
          adhdAssist,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (!chat && shouldCreateChat && !ephemeral) {
      chat = await prisma.chat.create({
        data: {
          userId: actingUser.id,
          chatbotType: expectedChatbotType,
          courseId: effectiveCourseId,
          systemPrompt: trimmedSystemPrompt,
          adhdAssist,
        },
      });
    }

    // Stateless callers get an in-memory chat stub (id: null) so downstream code
    // can read systemPrompt/adhdAssist without persisting anything.
    if (ephemeral && !chat) {
      chat = {
        id: null,
        userId: actingUser.id,
        courseId: effectiveCourseId,
        systemPrompt: trimmedSystemPrompt,
        adhdAssist,
      } as unknown as NonNullable<typeof chat>;
    }

    if (process.env.CHAT_API_DEBUG === "1") {
      console.log("[chat-api] adhdAssist", { adhdAssist, chatId: chat?.id });
    }

    if (!chat) {
      return new Response(JSON.stringify({ error: "Unable to resolve chat context" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch only the slice of history we plan to send back to the LLM. Stateless
    // callers have no persisted history (and a null chat id), so skip the query.
    const maxContextMessages = resolveMaxContextMessages();
    const recentMessageRecords =
      ephemeral || !chat.id
        ? []
        : await prisma.chatMessage.findMany({
            where: { chatId: chat.id },
            orderBy: { position: "desc" },
            take: maxContextMessages,
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
      mergedMessages.length > maxContextMessages
        ? mergedMessages.slice(-maxContextMessages)
        : mergedMessages;

    chatApiDebug("chat history merged", {
      mergedCount: mergedMessages.length,
      trimmedCount: trimmedMessages.length,
      maxContextMessages,
    });

    // Cap oversized tool results (#260), then digest older turns when the thread
    // exceeds the char budget (#259). Budget accounting counts tool payloads.
    let modelMessages = prepareBoundedSessionContext(
      capToolResultsInMessages(trimmedMessages),
    );

    if (mergedMessages.length === 0) {
      return new Response(
        JSON.stringify({
          chatId: chat?.id ?? null,
          systemPrompt: trimmedSystemPrompt ?? chat?.systemPrompt ?? null,
          adhdAssist: chat?.adhdAssist ?? adhdAssist,
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
    const parsedModel = parseModelIdentifier(model);
    if (!parsedModel) {
      return new Response(
        JSON.stringify({
          error:
            'Invalid model id. Use provider:modelId (e.g. vllm:qwen2.5-7b-instruct). Check Admin → AI Models.',
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const validatedApiKeys = mergeLocalInferenceFromEnv(
      toUserProviderSettings(apiKeysParsed.data),
      model,
    );

    if (!validatedApiKeys[parsedModel.providerId]?.isEnabled) {
      const envHint =
        parsedModel.providerId === "vllm"
          ? "VLLM_BASE_URL"
          : parsedModel.providerId === "ollama"
            ? "OLLAMA_BASE_URL"
            : "provider API key";
      return new Response(
        JSON.stringify({
          error: `Provider "${parsedModel.providerId}" is not available on this server. Set ${envHint} in apps/core/.env and restart the dev process.`,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const existingMessageIds = new Set(storedMessages.map((message) => message.id).filter(isNonEmptyString));
    const appendMessages = async (messages: GenericMessage[]) => {
      // Stateless callers never persist messages (no chat row / no real user).
      if (ephemeral || !chat?.id) return;
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
    const enabledProviders = listEnabledRegistryProviders(validatedApiKeys);

    if (!enabledProviders.includes(parsedModel.providerId)) {
      const envVar =
        parsedModel.providerId === "vllm" ? "VLLM_BASE_URL" : "OLLAMA_BASE_URL";
      return new Response(
        JSON.stringify({
          error: `Provider "${parsedModel.providerId}" is not available on this server (active: ${enabledProviders.join(", ") || "none"}). Set ${envVar} in apps/core/.env and restart the dev process.`,
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Persist only client-authored turns (user messages). The assistant reply is
    // owned by `onFinish`/the awaited path below, which stores it once under a
    // server id. Clients resend their whole `useChat` transcript every turn, and
    // their assistant copies carry client-generated ids that never match the
    // server id — persisting those here is what duplicated history on restore.
    await appendMessages(
      normalizedIncomingMessages.filter((message) => message.role !== "assistant"),
    );

    const lastUserMessage = [...trimmedMessages].reverse().find((message) => message.role === "user");
    const userQuestion = extractMessageText(lastUserMessage);
    const hasCourse = Boolean(effectiveCourseId);
    const courseRagNeeded = needsCourseRag(userQuestion, hasCourse);

    let aiModel;
    try {
      aiModel = registry.languageModel(model);
    } catch (err: unknown) {
      const available =
        typeof err === "object" &&
        err !== null &&
        "availableProviders" in err &&
        Array.isArray((err as { availableProviders?: string[] }).availableProviders)
          ? (err as { availableProviders: string[] }).availableProviders.join(", ")
          : enabledProviders.join(", ");
      return new Response(
        JSON.stringify({
          error: `Model "${model}" could not be loaded (providers on server: ${available}). For vLLM set VLLM_BASE_URL in .env and deploy the feat/VLLM provider code.`,
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const webToolsEnabled = await getPolicy("chat.webToolsEnabled");
    const resolvedSystemPrompt =
      trimmedSystemPrompt ?? sanitizeSystemPrompt(chat.systemPrompt) ?? null;

    let streamConfig;
    let supportsTools: boolean;
    let useToolCalling: boolean;
    let toolMaxTokens: number | undefined;
    let courseRagHits: HybridRagHit[] = [];
    let courseRagContextText = "";
    let courseRagInject = false;

    if (chatMode === "admin") {
      const rbacUser = {
        id: actingUser.id,
        role: actingUser.role,
      };

      const tools = createChatTools(
        {
          user: rbacUser,
          effectiveCourseId,
          effectiveCourseCode,
          restrictToStudentVisible: restrictRagToStudentVisible,
        },
        chatMode,
      );

      const buildDefaultSystemPrompt = () =>
        buildAdminSystemPrompt({
          customPrompt: resolvedSystemPrompt,
        });

      const activeChatModel = await resolveActiveChatModel(model);
      supportsTools = activeChatModel?.supportsTools ?? false;
      const contextWindow = resolveModelContextWindow(
        activeChatModel?.maxTokens,
        parsedModel.providerId,
      );
      const desiredMaxOutput = resolveMaxOutputTokens(
        activeChatModel?.maxTokens,
        parsedModel.providerId,
      );

      const adminSessionBudget =
        contextWindow <= 32_768
          ? Math.floor(contextWindow * ESTIMATED_CHARS_PER_TOKEN * 0.42)
          : undefined;

      modelMessages = prepareBoundedSessionContext(
        capToolResultsInMessages(trimmedMessages, 3000),
        adminSessionBudget
          ? {
              charBudget: adminSessionBudget,
              recentCount: 4,
              digestMaxChars: 3000,
            }
          : undefined,
      );

      chatApiTrace("model capability check", {
        chatMode,
        model,
        supportsTools,
        contextWindow,
        desiredMaxOutput,
        adminSessionBudget: adminSessionBudget ?? null,
        dbMaxTokens: activeChatModel?.maxTokens ?? null,
        chatId: chat?.id ?? null,
      });

      if (!supportsTools) {
        return chatApiReject(
          400,
          {
            error:
              "Admin chat requires a model with tool support. Select a tool-capable model in Admin → AI Models.",
            code: "ADMIN_TOOLS_REQUIRED",
          },
          { model, chatId: chat?.id ?? null },
        );
      }

      useToolCalling = true;

      streamConfig = {
        model: aiModel,
        messages: modelMessages,
        temperature: 0.2,
        maxTokens: desiredMaxOutput,
        maxSteps: TOOL_MAX_STEPS,
        tools,
        toolCallStreaming: streaming && parsedModel.providerId !== "vllm",
        system: buildDefaultSystemPrompt(),
      };

      const systemChars = typeof streamConfig.system === "string" ? streamConfig.system.length : 0;
      let messageChars = 0;
      for (const message of modelMessages) {
        messageChars += estimateMessageCharsForModel(message);
      }
      const estimatedInputTokens = estimateTokensFromChars(systemChars + messageChars);
      streamConfig.maxTokens = capMaxOutputTokensForPrompt({
        contextWindow,
        estimatedInputTokens,
        desiredMaxOutput,
      });

      chatApiTrace("max output tokens capped", {
        contextWindow,
        estimatedInputTokens,
        desiredMaxOutput,
        effectiveMaxTokens: streamConfig.maxTokens,
        systemChars,
        messageChars,
      });
    } else {
      const tools = buildChatToolRegistry({
        effectiveCourseId,
        webToolsEnabled,
        restrictToStudentVisible: restrictRagToStudentVisible,
      });
      const modelCapabilities = await getChatModelCapabilities(model);
      supportsTools = modelCapabilities.supportsTools;
      useToolCalling = supportsTools && !forceHybridRag;
      toolMaxTokens = resolveToolMaxOutputTokens(modelCapabilities.maxTokens);

      const defaultCourseSystemPrompt =
        resolvedSystemPrompt ||
        `You are EduAI, a helpful AI assistant for students and faculty at UBC Okanagan (UBCO).

IMPORTANT: You have access to the full conversation history in the messages array. When users ask about previous messages or context, refer to the conversation history provided to you. DO NOT claim you cannot remember past messages.

${LATEST_TURN_FOCUS_INSTRUCTION}

${courseCode ? `Current course context: ${courseCode} (UBCO). Do not ask the user for the course code if it's provided.` : ""}

Be helpful, conversational, and accurate. Use markdown for formatting. For mathematical expressions, use LaTeX delimiters: inline math with $$...$$ and display math with $$...$$ on its own line.`;

      if (shouldPrefetchCourseRag(hasCourse) && effectiveCourseId) {
        try {
          courseRagHits = await findRelevantContent(
            userQuestion,
            effectiveCourseId,
            HYBRID_RAG_MAX_CHUNKS,
            undefined,
            restrictRagToStudentVisible,
          );
          courseRagInject = shouldInjectCourseRag({
            hasCourse,
            courseRagNeeded,
            hits: courseRagHits,
          });
          if (courseRagInject && courseRagHits.length > 0) {
            courseRagContextText = buildCappedRagContextText(
              courseRagHits,
              HYBRID_RAG_MAX_CHUNKS,
              HYBRID_RAG_MAX_CONTEXT_CHARS,
            );
          }
        } catch (error) {
          console.error("Error prefetching course RAG context:", error);
          courseRagInject = shouldInjectCourseRag({
            hasCourse,
            courseRagNeeded,
            hits: [],
          });
        }
      }

      if (!useToolCalling) {
        if (courseRagInject && courseRagContextText) {
          streamConfig = {
            model: aiModel,
            messages: modelMessages,
            temperature: 0.6,
            maxTokens: 8192,
            system: `${defaultCourseSystemPrompt}

${buildRagSystemBlock(courseRagContextText)}`,
          };
        } else if (courseRagInject && !resolvedSystemPrompt) {
          // Default tutor chat: tell the student materials were empty.
          // Skip this refusal when a custom systemPrompt is set (extensions /
          // structured generation) — otherwise JSON/variant generation fails.
          streamConfig = {
            model: aiModel,
            messages: modelMessages,
            temperature: 0.6,
            maxTokens: 8192,
            system: `${defaultCourseSystemPrompt}

${buildEmptyCourseRagBlock()}`,
          };
        } else {
          streamConfig = {
            model: aiModel,
            messages: modelMessages,
            temperature: 0.6,
            maxTokens: 8192,
            system: defaultCourseSystemPrompt,
          };
        }
      } else {
        const baseSystemPrompt = resolvedSystemPrompt || `You are EduAI, a helpful AI assistant for students and faculty at UBC Okanagan (UBCO).

IMPORTANT: You have access to the full conversation history in the messages array. When users ask about previous messages or context, refer to the conversation history provided to you. DO NOT claim you cannot remember past messages.

${LATEST_TURN_FOCUS_INSTRUCTION}`;

        let toolSystemPrompt = buildToolCallingSystemPrompt({
          basePrompt: baseSystemPrompt,
          courseCode: courseCode ?? undefined,
          webToolsEnabled,
          hasPreloadedRag: Boolean(courseRagContextText),
        });

        if (courseRagContextText) {
          toolSystemPrompt = `${toolSystemPrompt}

${buildRagSystemBlock(courseRagContextText, { toolPath: true })}`;
        } else if (courseRagInject && !resolvedSystemPrompt) {
          toolSystemPrompt = `${toolSystemPrompt}

${buildEmptyCourseRagBlock()}`;
        }

        streamConfig = {
          model: aiModel,
          messages: modelMessages,
          temperature: 0.6,
          maxTokens: toolMaxTokens,
          maxSteps: TOOL_MAX_STEPS,
          tools,
          toolCallStreaming: streaming,
          system: toolSystemPrompt,
        };
      }
    }

    const effectiveAdhdAssist = resolveEffectiveAdhdAssist({
      hasField: hasAdhdAssistField,
      bodyValue: adhdAssist,
      chatValue: chat.adhdAssist,
    });

    const lastUserText = extractMessageText(
      [...trimmedMessages].reverse().find((message) => message.role === "user"),
    );
    const priorAssistantText = extractMessageText(
      [...trimmedMessages].reverse().find((message) => message.role === "assistant"),
    );

    let adhdProfile: AdhdTurnProfile | undefined;
    let adhdProfileRequirements:
      | ReturnType<typeof getProfileRequirements>
      | undefined;

    if (effectiveAdhdAssist) {
      adhdProfile = resolveAdhdTurnProfile({ userText: lastUserText, priorAssistantText });
      adhdProfileRequirements = getProfileRequirements(adhdProfile);
    }

    streamConfig.system = composeSecurityPrompt(
      composeSystemPrompt(streamConfig.system ?? "", {
        adhdAssist: effectiveAdhdAssist,
        profile: adhdProfile,
      }),
    );

    const streamStartedAt = Date.now();
    // True when course material reached the model this turn: either a tool
    // (RAG / web) ran — set by onStepFinish below — or hybrid/preloaded RAG
    // context was injected straight into the system prompt with no tool call.
    // Either path means a Sources footer should be expected (citation compliance).
    let adhdToolsUsed = Boolean(courseRagContextText);
    const needsOversight =
      chatMode !== "admin" &&
      effectiveAdhdAssist &&
      isAdhdOversightEnabled() &&
      (adhdProfileRequirements?.runDean ?? true);
    const adhdWordCap =
      adhdProfileRequirements?.wordCap ?? resolveAdhdResponseWordCap(lastUserText);

    const logResponseCompliance = (
      assistantText: string,
      extras?: {
        finishReason?: string | null;
        promptTokens?: number;
        completionTokens?: number;
        oversightRewritten?: boolean;
        oversightMethod?: OversightMethod;
        preStructuralPass?: boolean;
        oversightDurationMs?: number;
        oversightPromptTokens?: number;
        oversightCompletionTokens?: number;
        responseProfile?: AdhdTurnProfile;
        profileStructuralPass?: boolean;
      },
    ) => {
      const trimmed = assistantText?.trim();
      if (!trimmed) return;
      const metrics = computeAdhdResponseMetrics(trimmed, { wordCap: adhdWordCap });
      const profileStructuralPass =
        adhdProfile != null
          ? isProfileStructuralPass(metrics, adhdProfile, trimmed)
          : undefined;
      void recordResponseComplianceEvent({
        userId: actingUser.id,
        chatId: chat.id,
        adhdAssist: effectiveAdhdAssist,
        assistantText: trimmed,
        extras: {
          model,
          wordCap: adhdWordCap,
          durationMs: Date.now() - streamStartedAt,
          finishReason: extras?.finishReason ?? null,
          promptTokens: extras?.promptTokens,
          completionTokens: extras?.completionTokens,
          oversightRewritten: extras?.oversightRewritten,
          oversightMethod: extras?.oversightMethod,
          preStructuralPass: extras?.preStructuralPass,
          oversightDurationMs: extras?.oversightDurationMs,
          oversightPromptTokens: extras?.oversightPromptTokens,
          oversightCompletionTokens: extras?.oversightCompletionTokens,
          responseProfile: adhdProfile,
          profileStructuralPass,
          toolsUsed: adhdToolsUsed,
        },
      }).catch((err) => {
        console.error("[assistive-events] response_compliance log failed", err);
      });
    };

    // Log the LLM stream configuration
    chatApiDebug("Starting LLM stream", {
      chatMode,
      model,
      supportsTools,
      courseRagNeeded,
      courseRagInject,
      ragTopSimilarity: courseRagHits[0]?.similarity ?? null,
      ragChunkCount: courseRagHits.length,
      webToolsEnabled,
      forceHybridRag,
      approach: useToolCalling ? "tool_calling" : "hybrid_rag",
      toolMaxTokens: useToolCalling ? toolMaxTokens : undefined,
      adhdOversight: needsOversight,
      ...llmPromptSizeHints(streamConfig.system, modelMessages),
    });
    const streamTrace = {
      chatMode,
      model,
      chatId: chat.id,
      supportsTools,
      providerId: parsedModel.providerId,
    };

    let result;
    try {
      result = await streamText({
        ...(streamConfig as Parameters<typeof streamText>[0]),
        abortSignal: request.signal,
        onStepFinish: ({ toolCalls, toolResults }) => {
          if ((toolCalls?.length ?? 0) > 0 || (toolResults?.length ?? 0) > 0) {
            adhdToolsUsed = true;
          }
        },
        onFinish: needsOversight
          ? undefined
          : async ({ text, usage, finishReason, response }) => {
              // For streaming responses, persist here. Non-streaming path calls
              // consumeStream() which also triggers onFinish, so we skip here to
              // avoid saving the assistant message twice with different UUIDs.
              logResponseCompliance(text, {
                finishReason,
                promptTokens: usage?.promptTokens,
                completionTokens: usage?.completionTokens,
              });
              if (!streaming) return;
              const assistantText = text || extractAssistantText(response?.messages);
              if (assistantText) {
                await appendMessages([
                  { id: randomUUID(), role: "assistant", content: assistantText },
                ]).catch((err) => {
                  console.error("[chat-api] failed to persist streaming assistant message", err);
                });
              }
            },
        onError:
          chatMode === "admin"
            ? ({ error }) => {
                logStreamError(error, streamTrace);
              }
            : undefined,
      });
    } catch (error) {
      if (isClientAbort(error, request.signal)) {
        return clientAbortResponse();
      }
      if (chatMode === "admin") {
        logStreamError(error, streamTrace);
        const hint =
          parsedModel.providerId === "vllm"
            ? " Pick a tool-capable vLLM model registered in Admin → AI Models."
            : "";
        return chatApiReject(
          502,
          {
            error: `LLM stream failed: ${formatStreamError(error)}.${hint}`,
            code: "LLM_STREAM_FAILED",
          },
          streamTrace,
        );
      }
      throw error;
    }

    if (needsOversight) {
      let draft = "";
      let finalText = "";
      let usage: Awaited<typeof result.usage> | undefined;
      let finishReason: Awaited<typeof result.finishReason> | undefined;
      let sources: Awaited<typeof result.sources> | undefined;
      let reasoning: Awaited<typeof result.reasoning> | undefined;
      let response: Awaited<typeof result.response> | undefined;

      try {
        await result.consumeStream();

        const consumed = await Promise.all([
          result.text,
          result.usage,
          result.finishReason,
          result.sources,
          result.reasoning,
          result.response,
        ]);
        const text = consumed[0];
        usage = consumed[1];
        finishReason = consumed[2];
        sources = consumed[3];
        reasoning = consumed[4];
        response = consumed[5];

        draft = (text ?? "").trim();
        const audited = draft
          ? await auditAndMaybeRewrite({
              draft,
              model: aiModel,
              wordCap: adhdWordCap,
              profile: adhdProfile ?? "full_tutoring",
            })
          : emptyOversightAuditResult();

        finalText = audited.text || draft;
        logResponseCompliance(finalText, {
          finishReason,
          promptTokens: usage?.promptTokens,
          completionTokens: usage?.completionTokens,
          oversightRewritten: audited.rewritten,
          oversightMethod: audited.method,
          preStructuralPass: audited.beforeMetrics.structuralPass,
          oversightDurationMs: audited.oversightDurationMs,
          oversightPromptTokens: audited.oversightUsage?.promptTokens,
          oversightCompletionTokens: audited.oversightUsage?.completionTokens,
        });

        const persistOverseenAssistantMessages = async (text: string) => {
          const toPersist = buildOverseenAssistantMessagesToPersist(response?.messages, text);
          if (toPersist.length > 0) {
            await appendMessages(toPersist);
          }
        };

        if (streaming) {
          const headers: Record<string, string> = {
            "Content-Encoding": "none",
            "Transfer-Encoding": "chunked",
            Connection: "keep-alive",
          };
          if (chat?.id) {
            headers["X-Chat-Id"] = chat.id;
          }
          headers["X-Web-Tools-Enabled"] = webToolsEnabled ? "1" : "0";

          await persistOverseenAssistantMessages(finalText);

          return createDataStreamResponse({
            headers,
            execute: (dataStream) => {
              if (finalText) {
                dataStream.write(formatDataStreamPart("text", finalText));
              }
              dataStream.write(
                formatDataStreamPart("finish_message", {
                  finishReason: finishReason ?? "stop",
                }),
              );
            },
          });
        }

        await persistOverseenAssistantMessages(finalText);

        return new Response(
          JSON.stringify({
            content: finalText,
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
        if (isClientAbort(error, request.signal)) {
          return clientAbortResponse();
        }
        console.error("Error in ADHD oversight response:", error);
        return new Response(
          JSON.stringify({
            error: "Failed to generate overseen response",
            details: error instanceof Error ? error.message : "Unknown error",
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }

    if (streaming) {
      const headers: Record<string, string> = {
        "Content-Encoding": "none",
        "Transfer-Encoding": "chunked",
        Connection: "keep-alive",
      };
      if (chat?.id) {
        headers["X-Chat-Id"] = chat.id;
      }
      headers["X-Web-Tools-Enabled"] = webToolsEnabled ? "1" : "0";
      return result.toDataStreamResponse({
        headers,
        ...(chatMode === "admin"
          ? {
              getErrorMessage: (error) => {
                logStreamError(error, streamTrace);
                const base = formatStreamError(error);
                if (parsedModel.providerId === "vllm") {
                  return `${base} — Check that the selected model supports tools and that max output tokens fit the vLLM context window.`;
                }
                return base;
              },
            }
          : {}),
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
        } else {
          const assistantText = text || extractAssistantText(response?.messages);
          if (assistantText) {
            await appendMessages([
              {
                id: randomUUID(),
                role: "assistant",
                content: assistantText,
              },
            ]);
          }
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
        if (isClientAbort(error, request.signal)) {
          return clientAbortResponse();
        }
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
    if (isClientAbort(error, request.signal)) {
      return clientAbortResponse();
    }
    console.error("Chat API error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
