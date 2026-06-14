import type { Prisma, User } from "@prisma/client";
import { UserRole } from "@prisma/client";
import { randomUUID } from "crypto";
import { streamText } from "ai";
import {
  createAIProviderRegistry,
  listEnabledRegistryProviders,
  mergeLocalInferenceFromEnv,
  parseModelIdentifier,
} from "~/lib/ai/providers";
import { modelSupportsTools } from "~/lib/ai/providers.server";
import { composeSystemPrompt, resolveEffectiveAdhdAssist } from "~/lib/ai/adhd-assist";
import { recordResponseComplianceEvent } from "~/lib/assistive-events.server";
import { findRelevantContent } from "~/lib/ai/embedding";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import { auth } from "~/lib/auth/server";
import type { ActionFunctionArgs } from "react-router";
import {
  buildAdminSystemPrompt,
  buildLearningAssistantSystemPrompt,
  buildLearningSystemPrompt,
  chatbotTypeFromMode,
  createChatTools,
  parseChatMode,
} from "~/lib/agent-tools";
import prisma from "~/lib/prisma.server";
import { chatApiDebug, chatApiReject, chatApiTrace } from "~/lib/chat-api-log";
import { clientApiKeysBodySchema, toUserProviderSettings } from "~/lib/chat-api-keys.schema";
import {
  buildCappedRagContextText,
  capToolResultsInMessages,
  estimateMessageCharsForModel,
  extractMessageText,
  prepareBoundedSessionContext,
  resolveMaxContextMessages,
  HYBRID_RAG_MAX_CHUNKS,
  HYBRID_RAG_MAX_CONTEXT_CHARS,
} from "~/lib/chat-rag";

const TOOL_MAX_STEPS = Math.min(
  32,
  Math.max(1, Number(process.env.CHAT_TOOL_MAX_STEPS) || 12),
);
const TOOL_MAX_TOKENS = Math.min(
  128_000,
  Math.max(1024, Number(process.env.CHAT_TOOL_MAX_OUTPUT_TOKENS) || 32_000),
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
    return error.message || error.name;
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

    if (chatMode === "admin" && actingUser.role !== UserRole.ADMIN) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    const normalizedIncomingMessages = rawMessages
      .map((m) => normalizeMessage(m))
      .filter((m): m is GenericMessage => m !== null);

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
    const effectiveCourseId = resolvedCourseId || courseId || null;

    // §10 (#302): course-scoped chats require course access for the acting
    // user. Students need an active enrollment AND a published course; an
    // inactive enrollment blocks new chats but never own-history reads
    // (GET /api/chats/:chatId is ownership-scoped and unaffected).
    // Chats without a course context (general assistant) are not gated.
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
    }

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
      if (chat.chatbotType !== expectedChatbotType) {
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
            chatbotType: expectedChatbotType,
            systemPrompt: trimmedSystemPrompt,
            adhdAssist,
          },
        });
      }
    }

    if (hasAdhdAssistField && chat && chat.adhdAssist !== adhdAssist) {
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

    if (!chat && shouldCreateChat) {
      chat = await prisma.chat.create({
        data: {
          userId: actingUser.id,
          chatbotType: expectedChatbotType,
          systemPrompt: trimmedSystemPrompt,
          adhdAssist,
        },
      });
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

    // Fetch only the slice of history we plan to send back to the LLM.
    const maxContextMessages = resolveMaxContextMessages();
    const recentMessageRecords = await prisma.chatMessage.findMany({
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
    const modelMessages = prepareBoundedSessionContext(
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
      return chatApiReject(
        400,
        { error: "Missing required fields", code: "MISSING_MODEL_OR_API_KEYS" },
        {
          chatMode,
          chatId: chat?.id ?? null,
          hasModel: Boolean(model),
          hasApiKeys: typeof apiKeys === "object" && apiKeys !== null,
        },
      );
    }

    // Validate API keys
    const apiKeysParsed = clientApiKeysBodySchema.safeParse(apiKeys);
    if (!apiKeysParsed.success) {
      return chatApiReject(
        400,
        {
          error: "Invalid apiKeys",
          code: "INVALID_API_KEYS",
          details: apiKeysParsed.error.flatten(),
        },
        { chatMode, model, chatId: chat?.id ?? null },
      );
    }
    const parsedModel = parseModelIdentifier(model);
    if (!parsedModel) {
      return chatApiReject(
        400,
        {
          error:
            'Invalid model id. Use provider:modelId (e.g. vllm:qwen2.5-7b-instruct). Check Admin → AI Models.',
          code: "INVALID_MODEL_ID",
        },
        { chatMode, model, chatId: chat?.id ?? null },
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
      return chatApiReject(
        400,
        {
          error: `Provider "${parsedModel.providerId}" is not available on this server. Set ${envHint} in apps/core/.env and restart the dev process.`,
          code: "PROVIDER_NOT_ENABLED",
        },
        { chatMode, model, providerId: parsedModel.providerId, chatId: chat?.id ?? null },
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

    await appendMessages(normalizedIncomingMessages);

    const rbacUser = {
      id: actingUser.id,
      role: actingUser.role,
    };

    const tools = createChatTools(
      {
        user: rbacUser,
        effectiveCourseId,
        effectiveCourseCode: courseCode ?? null,
      },
      chatMode,
    );

    const resolvedSystemPrompt = trimmedSystemPrompt ?? chat.systemPrompt ?? null;

    const buildDefaultSystemPrompt = () =>
      chatMode === "admin"
        ? buildAdminSystemPrompt({
            courseCode,
            effectiveCourseId,
            customPrompt: resolvedSystemPrompt,
          })
        : buildLearningSystemPrompt({ courseCode, customPrompt: resolvedSystemPrompt });

    const buildLearningNonToolSystemPrompt = (citeMaterials: boolean) =>
      buildLearningAssistantSystemPrompt({
        courseCode,
        customPrompt: resolvedSystemPrompt,
        citeMaterials,
      });

    // Check if the model supports tool calling
    const supportsTools = await modelSupportsTools(model);

    chatApiTrace("model capability check", {
      chatMode,
      model,
      supportsTools,
      chatId: chat?.id ?? null,
    });

    if (chatMode === "admin" && !supportsTools) {
      console.warn("[chat-api] admin chat using a model without tool support — DB queries disabled", {
        model,
        chatId: chat?.id ?? null,
        code: "ADMIN_TOOLS_UNAVAILABLE",
      });
    }

    let streamConfig;

    if (!supportsTools) {
      // MODELS WITHOUT TOOL SUPPORT: learning chats may use hybrid RAG; admin never does.
      if (chatMode === "admin") {
        streamConfig = {
          model: aiModel,
          messages: modelMessages,
          temperature: 0.6,
          maxTokens: 8192,
          system: buildDefaultSystemPrompt(),
        };
      } else {
        const lastUserMessage = [...trimmedMessages].reverse().find((message) => message.role === "user");
        const userQuestion = extractMessageText(lastUserMessage);
        const messageContentLower = userQuestion.toLowerCase();

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

            const baseSystemPrompt = buildLearningNonToolSystemPrompt(true);

            const systemWithRAG = contextText
              ? `${baseSystemPrompt}

${contextText ? `Here are relevant excerpts from the course materials to help answer the user's question:

${contextText}

Based on this information, provide a comprehensive answer to the user's question. If the provided content doesn't fully answer their question, mention what you can answer based on the available materials and suggest what additional information might be helpful.` : "I don't have access to specific course materials for this question, but I can provide general educational assistance."}`
              : baseSystemPrompt;

            streamConfig = {
              model: aiModel,
              messages: modelMessages,
              temperature: 0.6,
              maxTokens: 8192,
              system: systemWithRAG,
            };
          } catch (error) {
            console.error("Error finding relevant content for model without tool support:", error);
            streamConfig = {
              model: aiModel,
              messages: modelMessages,
              temperature: 0.6,
              maxTokens: 8192,
              system: buildLearningNonToolSystemPrompt(false),
            };
          }
        } else {
          streamConfig = {
            model: aiModel,
            messages: modelMessages,
            temperature: 0.6,
            maxTokens: 8192,
            system: buildLearningNonToolSystemPrompt(false),
          };
        }
      }
    } else {
      streamConfig = {
        model: aiModel,
        messages: modelMessages,
        temperature: chatMode === "admin" ? 0.2 : 0.6,
        maxTokens: TOOL_MAX_TOKENS,
        maxSteps: TOOL_MAX_STEPS,
        tools,
        // vLLM tool-call streaming is unreliable on some served models (7B).
        toolCallStreaming: streaming && parsedModel.providerId !== "vllm",
        system: buildDefaultSystemPrompt(),
      };
    }

    const effectiveAdhdAssist = resolveEffectiveAdhdAssist({
      hasField: hasAdhdAssistField,
      bodyValue: adhdAssist,
      chatValue: chat.adhdAssist,
    });
    streamConfig.system = composeSystemPrompt(streamConfig.system ?? "", { adhdAssist: effectiveAdhdAssist });

    const streamStartedAt = Date.now();
    const logResponseCompliance = (
      assistantText: string,
      extras?: {
        finishReason?: string | null;
        promptTokens?: number;
        completionTokens?: number;
      },
    ) => {
      const trimmed = assistantText?.trim();
      if (!trimmed) return;
      void recordResponseComplianceEvent({
        userId: actingUser.id,
        chatId: chat.id,
        adhdAssist: effectiveAdhdAssist,
        assistantText: trimmed,
        extras: {
          model,
          durationMs: Date.now() - streamStartedAt,
          finishReason: extras?.finishReason ?? null,
          promptTokens: extras?.promptTokens,
          completionTokens: extras?.completionTokens,
        },
      }).catch((err) => {
        console.error("[assistive-events] response_compliance log failed", err);
      });
    };

    // Log the LLM stream configuration
    chatApiDebug("Starting LLM stream", {
      chatMode,
      supportsTools,
      providerId: parsedModel.providerId,
      model,
      approach: supportsTools ? "tool_calling" : "hybrid_rag",
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
        onFinish: async ({ text, usage, finishReason }) => {
          logResponseCompliance(text, {
            finishReason,
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
          });
        },
        onError: ({ error }) => {
          logStreamError(error, streamTrace);
        },
      });
    } catch (error) {
      logStreamError(error, streamTrace);
      const hint =
        chatMode === "admin" && parsedModel.providerId === "vllm"
          ? " Admin chat on vLLM requires a tool-capable backend (e.g. qwen2.5-32b-instruct with tool flags on cmps01). The 7B model is for learning chat / hybrid RAG only."
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
        getErrorMessage: (error) => {
          logStreamError(error, streamTrace);
          const base = formatStreamError(error);
          if (chatMode === "admin" && parsedModel.providerId === "vllm") {
            return `${base} — Try vllm:qwen2.5-32b-instruct for admin tools, or set supportsTools=false on the 7B model for learning chat only.`;
          }
          return base;
        },
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
    console.error("[chat-api] unhandled error", error);
    return chatApiReject(500, { error: "Internal server error", code: "INTERNAL_ERROR" });
  }
}
