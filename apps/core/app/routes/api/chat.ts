import type { Prisma, User } from "@prisma/client";
import { UserRole } from "@prisma/client";
import { randomUUID } from "crypto";
import { createDataStreamResponse, formatDataStreamPart, generateText, streamText, tool } from "ai";
import {
  createAIProviderRegistry,
  listEnabledRegistryProviders,
  mergeLocalInferenceFromEnv,
  parseModelIdentifier,
} from "~/lib/ai/providers";
import {
  activeRouterVersion,
  parseRouterMode,
  resolveRoutedModel,
  type RouterMode,
} from "~/lib/ai/routing/router";
import {
  coalesceTokenUsage,
  normalizeTokenUsage,
  persistAiInteractionTelemetry,
} from "~/lib/ai/routing/telemetry";
import { modelSupportsTools } from "~/lib/ai/providers.server";
import { composeSystemPrompt, resolveEffectiveAdhdAssist } from "~/lib/ai/adhd-assist";
import {
  auditAndMaybeRewrite,
  buildOverseenAssistantMessagesToPersist,
  emptyOversightAuditResult,
  isAdhdOversightEnabled,
} from "~/lib/ai/adhd-oversight";
import { resolveAdhdResponseWordCap } from "~/lib/ai/adhd-metrics";
import { recordResponseComplianceEvent } from "~/lib/assistive-events.server";
import { needsCourseRag } from "~/lib/ai/chat-intent";
import { findRelevantContent } from "~/lib/ai/embedding";
import { enforceAdminIfApiKey, requireServiceKey } from "~/lib/auth/guards.server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import { auth } from "~/lib/auth/server";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  appendHybridWebContext,
  buildHybridWebToolContext,
  inferHybridWebToolMode,
} from "~/lib/ai/hybrid-web-tools";
import { webSearch, fetchPage } from "~/lib/ai/tools";
import prisma from "~/lib/prisma.server";
import { chatApiDebug } from "~/lib/chat-api-log";
import { clientApiKeysBodySchema, toUserProviderSettings } from "~/lib/chat-api-keys.schema";
import { getPolicy } from "~/lib/policy.server";
import {
  buildCappedRagContextText,
  buildRagSystemBlock,
  capRagHitsForTool,
  capToolResultsInMessages,
  estimateMessageCharsForModel,
  extractMessageText,
  prepareBoundedSessionContext,
  resolveMaxContextMessages,
  HYBRID_RAG_MAX_CHUNKS,
  HYBRID_RAG_MAX_CONTEXT_CHARS,
} from "~/lib/chat-rag";
import { routerAutoDefaultEnabled } from "~/lib/router-env.server";

function autoRoutingHeaders(
  resolvedModelId: string,
  routingTier: 1 | 2 | 3 | null,
  wasAuto: boolean,
  routerVersion?: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Routed-Model": resolvedModelId,
  };
  if (wasAuto) {
    if (routingTier != null) {
      headers["X-Routing-Tier"] = String(routingTier);
    }
    headers["X-Router-Version"] = routerVersion ?? activeRouterVersion();
  }
  return headers;
}

/** OpenAI-compatible local backends need explicit stream usage for token telemetry. */
function usageProviderOptions(providerId: string) {
  if (providerId === "vllm" || providerId === "ollama") {
    return {
      [providerId]: { streamOptions: { includeUsage: true } },
    } as const;
  }
  return undefined;
}

function resolveAutoRouting(
  model: string | undefined,
): { routeWithAuto: boolean; modeOverride?: RouterMode; requestedAuto: string | null } {
  if (model === undefined || model === "auto") {
    return { routeWithAuto: true, requestedAuto: model ?? "auto" };
  }
  if (model === "auto-llm") {
    return {
      routeWithAuto: true,
      modeOverride: "llm",
      requestedAuto: "auto-llm",
    };
  }
  if (model === "auto-hybrid") {
    return {
      routeWithAuto: true,
      modeOverride: "hybrid",
      requestedAuto: "auto-hybrid",
    };
  }
  return { routeWithAuto: false, requestedAuto: null };
}

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

function userMessageHasImages(message?: GenericMessage): boolean {
  const content = message?.content;
  if (!content) {
    return false;
  }

  const partLooksLikeImage = (part: unknown): boolean => {
    if (!part || typeof part !== "object") {
      return false;
    }
    const p = part as Record<string, unknown>;
    const t = p.type;
    if (t === "image" || t === "image_url") {
      return true;
    }
    if (t === "file") {
      const mime = p.mimeType;
      return typeof mime === "string" && mime.startsWith("image/");
    }
    return false;
  };

  if (Array.isArray(content)) {
    return content.some(partLooksLikeImage);
  }

  if (typeof content === "object" && content !== null && "parts" in content) {
    const parts = (content as { parts?: unknown }).parts;
    if (Array.isArray(parts)) {
      return parts.some(partLooksLikeImage);
    }
  }

  return false;
}

/** Cheap metrics for logs ? do not print full `system` / messages (RAG can be huge). */
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

function extractAssistantText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") continue;
    const role = (msg as { role?: unknown }).role;
    if (role !== "assistant") continue;
    const text = extractMessageText(msg as GenericMessage);
    if (text.trim()) return text;
  }
  return "";
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
    let session = await auth.api.getSession(request);
    let isServiceKeyCaller = false;
    if (!session?.user) {
      const serviceKeyError = await requireServiceKey(request);
      if (serviceKeyError) return serviceKeyError;
      isServiceKeyCaller = true;
      session = { user: { id: "service", name: "Service", role: "ADMIN" } } as unknown as typeof session;
    }

    const body = await request.json();
    const rawMessages: unknown[] = Array.isArray(body.messages) ? body.messages : [];
    let model = typeof body.model === "string" ? body.model.trim() : undefined;
    if (model === "") {
      model = undefined;
    }

    if (!routerAutoDefaultEnabled() && model === undefined) {
      return new Response(
        JSON.stringify({
          error: "Missing model",
          details:
            'ROUTER_AUTO_DEFAULT disables implicit Auto; send model "auto", "auto-llm", "auto-hybrid", or a concrete registry id.',
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const autoRouting = resolveAutoRouting(model);
    const routeWithAuto = autoRouting.routeWithAuto;
    const apiKeys = body.apiKeys as unknown;
    const courseId = typeof body.courseId === "string" ? body.courseId : undefined;
    const courseCode = typeof body.courseCode === "string" ? body.courseCode : undefined;
    const streaming = body.streaming === undefined ? true : Boolean(body.streaming);
    const forceHybridRag = body.forceHybridRag === true;
    const hybridWebTools = body.hybridWebTools === true;
    const chatId = typeof body.chatId === "string" ? body.chatId : undefined;
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

    let actingUser = session!.user;
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
    }

    const requestedCourseId = resolvedCourseId || courseId || null;
    if (chat?.courseId && requestedCourseId && requestedCourseId !== chat.courseId) {
      return new Response(JSON.stringify({ error: "COURSE_MISMATCH" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }

    const effectiveCourseId = resolvedCourseId || courseId || chat?.courseId || null;

    // #657: the global "general assistant" chat was removed ? every interactive
    // chat is now course-scoped. Server-to-server callers may still omit a course;
    // regular sessions may not.
    const isApiKeyCaller = isServiceKeyCaller;
    if (!effectiveCourseId && !isApiKeyCaller) {
      return new Response(JSON.stringify({ error: "COURSE_REQUIRED" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Section 10 (#302): course-scoped chats require course access for the acting
    // user. Students need an active enrollment AND a published course; an
    // inactive enrollment blocks new chats but never own-history reads
    // (GET /api/chats/:chatId is ownership-scoped and unaffected).
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

    // Persist any system-prompt change onto the chat loaded above.
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
            courseId: effectiveCourseId,
            systemPrompt: trimmedSystemPrompt,
            adhdAssist,
          },
        });
      }
    }

    if (chat && effectiveCourseId && chat.courseId !== effectiveCourseId && !chat.courseId) {
      chat = await prisma.chat.update({
        where: { id: chat.id },
        data: { courseId: effectiveCourseId },
      });
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
          courseId: effectiveCourseId,
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

    if ((!routeWithAuto && !model) || (apiKeys !== null && typeof apiKeys !== "object")) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const apiKeysInput =
      apiKeys === null || apiKeys === undefined ? {} : (apiKeys as Record<string, unknown>);

    // Validate API keys
    const apiKeysParsed = clientApiKeysBodySchema.safeParse(apiKeysInput);
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

    const telemetryLastUser = [...trimmedMessages].reverse().find((m) => m.role === "user");
    const lastUserMessageTextForTelemetry = extractTextFromMessage(telemetryLastUser);
    const hasAttachments = userMessageHasImages(telemetryLastUser);
    const hasCourse = Boolean(effectiveCourseId);
    const courseRagNeeded = needsCourseRag(lastUserMessageTextForTelemetry, hasCourse);

    let ragTopSimilarity: number | null = null;
    let ragChunkCount: number | null = null;
    let ragContextTokenEstimate: number | null = null;

    if (routeWithAuto && effectiveCourseId && lastUserMessageTextForTelemetry.trim().length > 0) {
      try {
        const ragPrefetch = await findRelevantContent(
          lastUserMessageTextForTelemetry,
          effectiveCourseId,
          HYBRID_RAG_MAX_CHUNKS,
        );
        ragChunkCount = ragPrefetch.length;
        ragTopSimilarity = ragPrefetch[0]?.similarity ?? null;
        ragContextTokenEstimate = ragPrefetch.reduce(
          (acc, hit) => acc + Math.ceil(hit.content.length / 4),
          0,
        );
      } catch (err) {
        chatApiDebug("Router RAG prefetch failed", { err });
      }
    }

    let wasAuto = false;
    let routingTier: 1 | 2 | 3 | null = null;
    let routerContext: Record<string, unknown> | null = null;
    let resolvedRouterVersion: string | null = null;

    if (routeWithAuto) {
      const decision = await resolveRoutedModel(
        lastUserMessageTextForTelemetry,
        {
          courseId: effectiveCourseId,
          courseCode: courseCode ?? null,
          imagesPresent: hasAttachments,
          ragTopSimilarity,
          ragChunkCount,
          ragContextTokenEstimate,
          courseRagNeeded,
        },
        autoRouting.modeOverride
          ? { modeOverride: autoRouting.modeOverride }
          : undefined,
      );
      model = decision.modelId;
      wasAuto = true;
      routingTier = decision.tier;
      routerContext = {
        ...decision.features,
        requestedAuto: autoRouting.requestedAuto,
      };
      resolvedRouterVersion =
        typeof decision.features.routerVersion === "string"
          ? decision.features.routerVersion
          : activeRouterVersion(autoRouting.modeOverride ?? parseRouterMode(process.env.ROUTER_MODE));
      chatApiDebug("Auto routing resolved model", {
        resolvedModelId: decision.modelId,
        routingTier: decision.tier,
        rule: decision.features.rule,
        requestedAuto: autoRouting.requestedAuto,
      });
    }

    const resolvedModelId = model!;
    const parsedModel = parseModelIdentifier(resolvedModelId);
    if (!parsedModel) {
      return new Response(
        JSON.stringify({
          error:
            'Invalid model id. Use provider:modelId (e.g. vllm:qwen2.5-7b-instruct). Check Admin ? AI Models.',
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const validatedApiKeysMerged = mergeLocalInferenceFromEnv(
      validatedApiKeys,
      resolvedModelId,
    );

    if (!validatedApiKeysMerged[parsedModel.providerId]?.isEnabled) {
      const envHint =
        parsedModel.providerId === "vllm"
          ? "VLLM_BASE_URL"
          : parsedModel.providerId === "ollama"
            ? "OLLAMA_BASE_URL"
            : "provider API key";
      return new Response(
        JSON.stringify({
          error: `Provider "${parsedModel.providerId}" is not available on this server. Set ${envHint} in apps/core/.env and restart the dev process.`,
          model: resolvedModelId,
          hint:
            parsedModel.providerId === "vllm"
              ? "Run npm run db:sync-ai-providers and confirm VLLM_BASE_URL is set."
              : undefined,
        }),
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

    const registry = createAIProviderRegistry(validatedApiKeysMerged);
    const enabledProviders = listEnabledRegistryProviders(validatedApiKeysMerged);

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
      aiModel = registry.languageModel(resolvedModelId);
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
          error: `Model "${resolvedModelId}" could not be loaded (providers on server: ${available}). For vLLM set VLLM_BASE_URL in .env and deploy the feat/VLLM provider code.`,
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    await appendMessages(normalizedIncomingMessages);

    const webToolsEnabled = await getPolicy("chat.webToolsEnabled");

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
      ...(webToolsEnabled ? { webSearch, fetchPage } : {}),
    };

    // Check if the model supports tool calling (research baseline may force hybrid RAG).
    // vLLM 32B tool loops hang on dev unless Hermes tool parser is fully wired — default to
    // hybrid RAG for vllm:* chat (same as research scripts). Opt in with VLLM_CHAT_TOOLS=1.
    const supportsTools = await modelSupportsTools(resolvedModelId);
    const effectiveForceHybridRag =
      forceHybridRag ||
      (parsedModel.providerId === "vllm" && process.env.VLLM_CHAT_TOOLS !== "1");
    const useToolCalling = supportsTools && !effectiveForceHybridRag;

    let streamConfig;
    let shouldPrefetchWebTools = false;

    const resolvedSystemPrompt = trimmedSystemPrompt ?? chat.systemPrompt ?? null;

    if (!useToolCalling) {
      // MODELS WITHOUT TOOL SUPPORT: Use hybrid RAG approach
      const userQuestion = lastUserMessageTextForTelemetry;

      shouldPrefetchWebTools =
        hybridWebTools ||
        (effectiveForceHybridRag && inferHybridWebToolMode(userQuestion) !== null);
      let hybridWebContextText = "";
      if (shouldPrefetchWebTools) {
        const webToolResult = await buildHybridWebToolContext(userQuestion);
        hybridWebContextText = webToolResult.context;
        if (webToolResult.error) {
          chatApiDebug("Hybrid web tool prefetch issue", {
            mode: webToolResult.mode,
            error: webToolResult.error,
          });
        }
      }

      const hybridRagAlwaysWithCourse = process.env.CHAT_HYBRID_RAG_ALWAYS_WITH_COURSE === "1";
      const isRAGQuery = hybridRagAlwaysWithCourse ? hasCourse : courseRagNeeded;

      if (isRAGQuery) {
        try {
          const relevantContent = await findRelevantContent(
            userQuestion,
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

${buildRagSystemBlock(contextText)}`
            : `${baseSystemPrompt}

I don't have access to specific course materials for this question, but I can provide general educational assistance.`;

          streamConfig = {
            model: aiModel,
            messages: modelMessages,
            temperature: 0.6,
            maxTokens: 8192,
            system: appendHybridWebContext(systemWithRAG, hybridWebContextText),
          };
        } catch (error) {
          console.error("Error finding relevant content for model without tool support:", error);
          const defaultSystemPrompt = resolvedSystemPrompt || `You are EduAI, a helpful AI assistant for students and faculty at UBC Okanagan (UBCO).

IMPORTANT: You have access to the full conversation history in the messages array. When users ask about previous messages or context, refer to the conversation history provided to you. DO NOT claim you cannot remember past messages.

${courseCode ? `Current course context: ${courseCode} (UBCO). Do not ask the user for the course code if it's provided.` : ""}

Be helpful, conversational, and accurate. Use markdown for formatting.`;

          streamConfig = {
            model: aiModel,
            messages: modelMessages,
            temperature: 0.6,
            maxTokens: 8192,
            system: appendHybridWebContext(defaultSystemPrompt, hybridWebContextText),
          };
        }
      } else {
        const defaultSystemPrompt = resolvedSystemPrompt || `You are EduAI, a helpful AI assistant for students and faculty at UBC Okanagan (UBCO).

IMPORTANT: You have access to the full conversation history in the messages array. When users ask about previous messages or context, refer to the conversation history provided to you. DO NOT claim you cannot remember past messages.

${courseCode ? `Current course context: ${courseCode} (UBCO). Do not ask the user for the course code if it's provided.` : ""}

Be helpful, conversational, and accurate. Use markdown for formatting.`;

        streamConfig = {
          model: aiModel,
          messages: modelMessages,
          temperature: 0.6,
          maxTokens: 8192,
          system: appendHybridWebContext(defaultSystemPrompt, hybridWebContextText),
        };
      }
    } else {
      const baseSystemPrompt = resolvedSystemPrompt || `You are EduAI, a helpful AI assistant for students and faculty at UBC Okanagan (UBCO).

IMPORTANT: You have access to the full conversation history in the messages array. When users ask about previous messages or context, refer to the conversation history provided to you. DO NOT claim you cannot remember past messages.`;

      let preloadedRagContext = "";
      if (courseRagNeeded && effectiveCourseId) {
        try {
          const relevantContent = await findRelevantContent(
            lastUserMessageTextForTelemetry,
            effectiveCourseId,
            HYBRID_RAG_MAX_CHUNKS,
          );
          preloadedRagContext =
            relevantContent.length > 0
              ? buildCappedRagContextText(
                  relevantContent,
                  HYBRID_RAG_MAX_CHUNKS,
                  HYBRID_RAG_MAX_CONTEXT_CHARS,
                )
              : "";
        } catch (error) {
          console.error("Error pre-loading course context for tool path:", error);
        }
      }

      const ragToolHint = preloadedRagContext
        ? "Course excerpts are already included below. Use getInformation only if those excerpts are insufficient."
        : "For course content questions, call getInformation first to retrieve relevant materials.";

      let defaultSystemPrompt = `${baseSystemPrompt}

You have access to two tools:
- getInformation: searches uploaded course materials (syllabi, lectures, assignments, etc.)
- webSearch: searches the web for current information, reviews, discussions, news, etc.
- fetchPage: opens a URL and returns the main page content as markdown for deeper reading. If a page fails to load, try other sources. Try and give a correct response to the user's query even if the page fails to load.

When answering questions:
1. ${ragToolHint}
2. If the user asks for reviews, opinions, recent updates, or external information (e.g., "what do students say about this course?" or "latest developments"), call webSearch after checking course materials. Prefer queries that include "UBCO" with the course code/name and the professor name when known.
3. After webSearch, call fetchPage on promising sources (e.g., RateMyProfessors, Reddit threads, official pages) to read the page content before answering. If the page fails to load, try other sources. Try and give a correct response to the user's query even if the page fails to load.
4. You may call tools multiple times in sequence if needed to give a complete answer.
5. Always cite your sources: mention course material titles for RAG results and include URLs for web results.

${courseCode ? `Current course context: ${courseCode} (UBCO). Do not ask the user for the course code if it's provided.` : ""}

Be helpful, conversational, and accurate. Use markdown for formatting.`;

      if (preloadedRagContext) {
        defaultSystemPrompt = `${defaultSystemPrompt}

${buildRagSystemBlock(preloadedRagContext, { toolPath: true })}`;
      }

      streamConfig = {
        model: aiModel,
        messages: modelMessages,
        temperature: 0.6,
        maxTokens: TOOL_MAX_TOKENS,
        maxSteps: TOOL_MAX_STEPS,
        tools,
        toolCallStreaming: streaming,
        system: defaultSystemPrompt,
      };
    }

    const effectiveAdhdAssist = resolveEffectiveAdhdAssist({
      hasField: hasAdhdAssistField,
      bodyValue: adhdAssist,
      chatValue: chat.adhdAssist,
    });
    streamConfig.system = composeSystemPrompt(streamConfig.system ?? "", { adhdAssist: effectiveAdhdAssist });

    const requestStartMs = Date.now();
    const needsOversight = effectiveAdhdAssist && isAdhdOversightEnabled();
    const lastUserText = extractMessageText(
      [...trimmedMessages].reverse().find((message) => message.role === "user"),
    );
    const adhdWordCap = resolveAdhdResponseWordCap(lastUserText);

    const logResponseCompliance = (
      assistantText: string,
      extras?: {
        finishReason?: string | null;
        promptTokens?: number;
        completionTokens?: number;
        oversightRewritten?: boolean;
        oversightMethod?: "none" | "deterministic" | "llm" | "llm_failed";
        preStructuralPass?: boolean;
        oversightDurationMs?: number;
        oversightPromptTokens?: number;
        oversightCompletionTokens?: number;
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
          model: resolvedModelId,
          wordCap: adhdWordCap,
          durationMs: Date.now() - requestStartMs,
          finishReason: extras?.finishReason ?? null,
          promptTokens: extras?.promptTokens,
          completionTokens: extras?.completionTokens,
          oversightRewritten: extras?.oversightRewritten,
          oversightMethod: extras?.oversightMethod,
          preStructuralPass: extras?.preStructuralPass,
          oversightDurationMs: extras?.oversightDurationMs,
          oversightPromptTokens: extras?.oversightPromptTokens,
          oversightCompletionTokens: extras?.oversightCompletionTokens,
        },
      }).catch((err) => {
        console.error("[assistive-events] response_compliance log failed", err);
      });
    };

    const finishMeta: {
      ready: boolean;
      usage?: Record<string, unknown>;
      finishReason: string;
    } = { ready: false, finishReason: "" };

    chatApiDebug("Starting LLM stream", {
      model: resolvedModelId,
      routedByAuto: wasAuto,
      approach: useToolCalling ? "tool_calling" : "hybrid_rag",
      adhdOversight: needsOversight,
      forceHybridRag: effectiveForceHybridRag,
      hybridWebTools: shouldPrefetchWebTools ?? false,
      courseRagNeeded,
      ...llmPromptSizeHints(streamConfig.system, modelMessages),
    });

    const providerOptions = usageProviderOptions(parsedModel.providerId);

    if (!streaming && !useToolCalling && !needsOversight && !effectiveAdhdAssist) {
      const genResult = await generateText({
        model: streamConfig.model,
        messages: streamConfig.messages as Parameters<typeof generateText>[0]["messages"],
        system: streamConfig.system,
        temperature: streamConfig.temperature,
        maxTokens: streamConfig.maxTokens,
        ...(providerOptions ? { providerOptions } : {}),
      });

      const normalizedUsage = normalizeTokenUsage(
        genResult.usage as Record<string, unknown> | undefined,
      );
      const finishReason = String(genResult.finishReason ?? "stop");

      await persistAiInteractionTelemetry({
        userId: actingUser.id,
        courseId: effectiveCourseId,
        resolvedModelId,
        query: lastUserMessageTextForTelemetry,
        responseText: genResult.text ?? "",
        usage: {
          promptTokens: normalizedUsage.promptTokens ?? undefined,
          completionTokens: normalizedUsage.completionTokens ?? undefined,
          totalTokens: normalizedUsage.totalTokens ?? undefined,
        },
        finishReason,
        durationMs: Date.now() - requestStartMs,
        wasAuto,
        routingTier,
        routerVersion: wasAuto ? resolvedRouterVersion : null,
        routerFeatures: routerContext,
      });

      if (genResult.text) {
        logResponseCompliance(genResult.text, {
          finishReason,
          promptTokens: normalizedUsage.promptTokens ?? undefined,
          completionTokens: normalizedUsage.completionTokens ?? undefined,
        });
        await appendMessages([
          {
            id: randomUUID(),
            role: "assistant",
            content: genResult.text,
          },
        ]);
      }

      return new Response(
        JSON.stringify({
          content: genResult.text,
          model: resolvedModelId,
          routedModel: resolvedModelId,
          usage: normalizedUsage,
          finishReason,
          sources: [],
          reasoning: undefined,
          responseId: genResult.response?.id,
          courseCode,
          chatId: chat?.id,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...autoRoutingHeaders(
              resolvedModelId,
              routingTier,
              wasAuto,
              resolvedRouterVersion,
            ),
          },
        },
      );
    }

    const result = await streamText({
      ...(streamConfig as Parameters<typeof streamText>[0]),
      ...(providerOptions ? { providerOptions } : {}),
      onFinish: needsOversight
        ? undefined
        : async ({ usage, finishReason, text, response }) => {
            finishMeta.usage = usage as Record<string, unknown> | undefined;
            finishMeta.finishReason = String(finishReason ?? "");
            finishMeta.ready = true;
            const normalizedFinishUsage = coalesceTokenUsage(
              finishMeta.usage,
              usage as Record<string, unknown> | undefined,
            );
            await persistAiInteractionTelemetry({
              userId: actingUser.id,
              courseId: effectiveCourseId,
              resolvedModelId,
              query: lastUserMessageTextForTelemetry,
              responseText: text ?? "",
              usage: {
                promptTokens: normalizedFinishUsage.promptTokens ?? undefined,
                completionTokens: normalizedFinishUsage.completionTokens ?? undefined,
                totalTokens: normalizedFinishUsage.totalTokens ?? undefined,
              },
              finishReason: finishMeta.finishReason,
              durationMs: Date.now() - requestStartMs,
              wasAuto,
              routingTier,
              routerVersion: wasAuto ? resolvedRouterVersion : null,
              routerFeatures: routerContext,
            });
            const assistantTextForCompliance = text || extractAssistantText(response?.messages);
            logResponseCompliance(assistantTextForCompliance, {
              finishReason,
              promptTokens: normalizedFinishUsage.promptTokens ?? undefined,
              completionTokens: normalizedFinishUsage.completionTokens ?? undefined,
            });
            if (!streaming) return;
            if (assistantTextForCompliance) {
              await appendMessages([
                { id: randomUUID(), role: "assistant", content: assistantTextForCompliance },
              ]).catch((err) => {
                console.error("[chat-api] failed to persist streaming assistant message", err);
              });
            }
          },
    });

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
            })
          : emptyOversightAuditResult();

        finalText = audited.text || draft;
        const normalizedOversightUsage = normalizeTokenUsage(
          usage as Record<string, unknown> | undefined,
        );
        await persistAiInteractionTelemetry({
          userId: actingUser.id,
          courseId: effectiveCourseId,
          resolvedModelId,
          query: lastUserMessageTextForTelemetry,
          responseText: finalText,
          usage: {
            promptTokens: normalizedOversightUsage.promptTokens ?? undefined,
            completionTokens: normalizedOversightUsage.completionTokens ?? undefined,
            totalTokens: normalizedOversightUsage.totalTokens ?? undefined,
          },
          finishReason: String(finishReason ?? "stop"),
          durationMs: Date.now() - requestStartMs,
          wasAuto,
          routingTier,
          routerVersion: wasAuto ? resolvedRouterVersion : null,
          routerFeatures: routerContext,
        });
        logResponseCompliance(finalText, {
          finishReason,
          promptTokens: normalizedOversightUsage.promptTokens ?? undefined,
          completionTokens: normalizedOversightUsage.completionTokens ?? undefined,
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
            ...autoRoutingHeaders(
              resolvedModelId,
              routingTier,
              wasAuto,
              resolvedRouterVersion,
            ),
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
            model: resolvedModelId,
            routedModel: resolvedModelId,
            usage: normalizedOversightUsage,
            finishReason,
            sources: sources || [],
            reasoning,
            responseId: response?.id,
            courseCode,
            chatId: chat?.id,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              ...autoRoutingHeaders(
                resolvedModelId,
                routingTier,
                wasAuto,
                resolvedRouterVersion,
              ),
            },
          },
        );
      } catch (error) {
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
        ...autoRoutingHeaders(
          resolvedModelId,
          routingTier,
          wasAuto,
          resolvedRouterVersion,
        ),
      };
      if (chat?.id) {
        headers["X-Chat-Id"] = chat.id;
      }
      headers["X-Web-Tools-Enabled"] = webToolsEnabled ? "1" : "0";
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

        const rawResponse = response as
          | { usage?: Record<string, unknown>; body?: { usage?: Record<string, unknown> } }
          | undefined;
        const normalizedUsage = coalesceTokenUsage(
          finishMeta.usage,
          usage as Record<string, unknown> | undefined,
          rawResponse?.usage,
          rawResponse?.body?.usage,
        );
        const resolvedFinishReason =
          finishMeta.finishReason || String(finishReason ?? "");

        return new Response(
          JSON.stringify({
            content: text,
            model: resolvedModelId,
            routedModel: resolvedModelId,
            usage: normalizedUsage,
            finishReason: resolvedFinishReason,
            sources: sources || [],
            reasoning,
            responseId: response?.id,
            courseCode,
            chatId: chat?.id,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              ...autoRoutingHeaders(
                resolvedModelId,
                routingTier,
                wasAuto,
                resolvedRouterVersion,
              ),
            },
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
