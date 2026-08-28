import type { JsonObject, JsonValue } from "~/lib/json-value";
import type { Prisma, User } from "@prisma/client";
import { UserRole } from "@prisma/client";
import { randomUUID } from "crypto";
import { z, ZodError } from "zod";
import { createDataStreamResponse, formatDataStreamPart, StreamData, streamText } from "ai";
import {
  createAIProviderRegistry,
  listEnabledRegistryProviders,
  mergeLocalInferenceFromEnv,
  parseModelIdentifier,
} from "~/lib/ai/providers";
import {
  classifyProviderFailure,
  classifyPublicProviderError,
  createProviderFailure,
  isProviderAbortError,
  providerFailureBody,
  providerFailureHeaders,
  providerErrorDiagnostic,
  type ProviderFailure,
} from "~/lib/ai/provider-errors.server";
import {
  activeRouterVersion,
  parseRouterMode,
  resolveRoutedModel,
  resolveRoutedModelRules,
  type RouterDecision,
  type RouterMode,
} from "~/lib/ai/routing/router";
import {
  AdmissionTimeoutError,
  acquireAiAdmission,
  withAdmissionRelease,
} from "~/lib/ai/admission.server";
import { registerActiveChatCancellation } from "~/lib/ai/active-chat-cancellations.server";
import { isEffectiveToolCallingAvailable } from "~/lib/ai/routing/local-vllm";
import { isActiveAdminUser } from "~/lib/api-keys/access.server";
import { coalesceTokenUsage } from "~/lib/ai/routing/telemetry";
import { persistAiInteractionTelemetry } from "~/lib/ai/routing/telemetry.server";
import {
  FleetUnavailableError,
  resolveFleetHost,
  resolveFleetHostAfterFailure,
} from "~/lib/ai/routing/fleet/resolve-fleet";
import { createStreamStartupProbe } from "~/lib/ai/routing/fleet/probe-stream";
import { fleetRoutingEnabled } from "~/lib/ai/routing/fleet/registry";
import { buildFleetRouterFeatures, parseWorkloadFeature } from "~/lib/ai/routing/fleet/types";
import { parseJobType, type FleetPick } from "~/lib/ai/routing/fleet/types";
import {
  enableBedrockOnSettings,
  isClientRequestedBedrockModel,
  tryActivateBedrockOverflow,
  type BedrockOverflowActivation,
} from "~/lib/ai/routing/bedrock/overflow.server";
import {
  capMaxOutputTokensForPrompt,
  estimateTokensFromChars,
  estimateToolDefinitionTokens,
  estimateAdminToolStepReserve,
  getChatModelCapabilities,
  promptFitsContextWindow,
  resolveActiveChatModel,
  resolveMaxOutputTokens,
  resolveModelContextWindow,
  ESTIMATED_CHARS_PER_TOKEN,
} from "~/lib/ai/providers.server";
import { resolveToolMaxOutputTokens } from "~/lib/ai/resolve-tool-max-tokens";
import { composeSystemPrompt, resolveEffectiveAdhdAssist } from "~/lib/ai/adhd-assist";
import {
  buildCourseResponseStylePrompt,
  appendCourseStyleToSystemPrompt,
} from "~/lib/ai/response-style-tags";
import { needsCourseRag } from "~/lib/ai/chat-intent";
import { capTokensForLongOutputIntent, didHitAppliedLongOutputCap } from "~/lib/ai/long-output-cap";
import {
  buildCourseScopePolicyPrompt,
  buildCourseScopeRedirectMessage,
  courseScopeGuardrailEnabled,
  resolveCourseScopeVerdict,
  MAX_COURSE_SCOPE_HISTORY_TURNS,
  type CourseScopeConversationTurn,
  type CourseScopeContext,
  type CourseScopeVerdict,
} from "~/lib/ai/course-scope-guardrail";
import { buildChatToolRegistry, buildToolCallingSystemPrompt } from "~/lib/ai/chat-tools";
import {
  appendCustomInstructions,
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
  isAdhdOversightDeterministicOnly,
  isAdhdOversightEnabled,
  type OversightMethod,
} from "~/lib/ai/adhd-oversight";
import {
  resolveAdhdResponseWordCap,
  isProfileStructuralPass,
  computeAdhdResponseMetrics,
} from "~/lib/ai/adhd-metrics";
import { recordResponseComplianceEvent } from "~/lib/assistive-events.server";
import { classifyRagRetrievalError, findRelevantContent } from "~/lib/ai/embedding";
import {
  courseCodeLookupCandidates,
  pickCourseIdByCandidatePriority,
} from "~/lib/courses/course-code-candidates";
import { getCourseTopicNamesCached } from "~/lib/courses/server";
import { resolveCourseAccessWithCourse, type AccessLevel } from "~/lib/auth/course-access.server";
import { enforceAdminIfApiKey, requireServiceKey } from "~/lib/auth/guards.server";
import { isUbcEmail } from "~/lib/auth/ubc-email";
import { checkRateLimit, getChatRateLimitConfig, parseEnvInt } from "~/lib/auth/rate-limit.server";
import { fireAndForget, logSecurityEvent } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import type { ActionFunctionArgs } from "react-router";
import {
  buildAdminSystemPrompt,
  chatbotTypeFromMode,
  createChatTools,
  parseChatMode,
  pickCoreAdminChatTools,
} from "~/lib/agent-tools";
import prisma from "~/lib/prisma.server";
import { enqueueQuestionGeneration, isEnqueueRequested } from "~/lib/queue/chat-producer.server";
import { httpStatusForEnqueueError } from "~/lib/queue/errors.server";
import { QueueFullError } from "~/lib/queue/queue-stats.server";
import { chatApiDebug, chatApiReject, chatApiTrace } from "~/lib/chat-api-log";
import { clientApiKeysBodySchema, toUserProviderSettings } from "~/lib/chat-api-keys.schema";
import { getUserProviderSettings } from "~/lib/user-provider-settings.server";
import { getPolicy } from "~/lib/policy.server";
import { shouldInjectCourseRag, shouldPrefetchCourseRag } from "~/lib/ai/course-rag-policy";
import {
  buildCappedRagContextText,
  buildEmptyCourseRagBlock,
  buildRagSystemBlock,
  capToolResultsInMessages,
  estimateMessageCharsForModel,
  extractMessageText,
  messageHasImageParts,
  LATEST_TURN_FOCUS_INSTRUCTION,
  prepareBoundedSessionContext,
  resolveMaxContextMessages,
  HYBRID_RAG_MAX_CHUNKS,
  HYBRID_RAG_MAX_CONTEXT_CHARS,
  type HybridRagHit,
} from "~/lib/chat-rag";
import { getRoutingModelSettings } from "~/lib/routing-model-settings.server";
import {
  withResolvedModelMetadata,
  withCourseScopeRedirectMetadata,
} from "~/lib/chat/chat-message-metadata";
import { getRequestSession } from "~/lib/auth/request-session.server";
import {
  readBoundedChatJson,
  resolveChatInputLimits,
  validateChatBody,
} from "~/lib/chat-input.server";

function autoRoutingHeaders(
  resolvedModelId: string,
  routingTier: 1 | 2 | 3 | null,
  wasAuto: boolean,
  routerVersion?: string | null,
  fleetServerId?: string | null,
) {
  const headers: Record<string, string> = {};
  headers["X-Routed-Model"] = resolvedModelId;
  if (wasAuto) {
    if (routingTier != null) {
      headers["X-Routing-Tier"] = String(routingTier);
    }
    headers["X-Router-Version"] = routerVersion ?? activeRouterVersion();
  }
  if (fleetServerId) {
    headers["X-Fleet-Server"] = fleetServerId;
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

/**
 * The request fields this route reads by name, decoded once `validateChatBody`
 * has cleared the size limits. Every field is independently recoverable: a
 * client sending the wrong type for one field must not fail the whole turn, it
 * simply reads as absent, exactly as the hand-written checks did before.
 *
 * Fields the route inspects for *presence* (`adhdAssist`, `systemPrompt`) are
 * still read off the raw body, since "sent as null" and "not sent" differ there.
 */
const chatRequestSchema = z
  .object({
    model: z.string().optional().catch(undefined),
    courseId: z.string().optional().catch(undefined),
    courseCode: z.string().optional().catch(undefined),
    chatId: z.string().optional().catch(undefined),
    // Any non-string, like any string other than "admin", is a learning chat.
    chatMode: z.string().optional().catch(undefined),
    systemPrompt: z.string().optional().catch(undefined),
    proxyUser: z
      .object({
        provider: z.string().optional().catch(undefined),
        id: z.string().optional().catch(undefined),
        email: z.string().optional().catch(undefined),
      })
      .optional()
      .catch(undefined),
  })
  .passthrough();

/**
 * Token counts as the AI SDK and the OpenAI-compatible providers spell them.
 * `coalesceTokenUsage` picks between the spellings; this only has to decode the
 * vendor object into named numbers first, and read a missing or malformed count
 * as absent rather than dropping the whole usage report.
 */
const tokenUsageSchema = z
  .object({
    promptTokens: z.number().optional().catch(undefined),
    inputTokens: z.number().optional().catch(undefined),
    prompt_tokens: z.number().optional().catch(undefined),
    completionTokens: z.number().optional().catch(undefined),
    outputTokens: z.number().optional().catch(undefined),
    completion_tokens: z.number().optional().catch(undefined),
    totalTokens: z.number().optional().catch(undefined),
    total_tokens: z.number().optional().catch(undefined),
  })
  .catch({});

type ChatTokenUsage = z.infer<typeof tokenUsageSchema>;

/**
 * The registry keys models as `provider:model`. Splitting and rejoining proves
 * that shape to the type system without asserting it.
 */
function toRegistryModelId(modelId: string): RegistryModelId {
  const [providerId, ...rest] = modelId.split(":");
  return `${providerId}:${rest.join(":")}`;
}

type AutoRoutingDecision = {
  routeWithAuto: boolean;
  modeOverride?: RouterMode;
  requestedAuto: string | null;
};

function resolveAutoRouting(model: string | undefined): AutoRoutingDecision {
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
  return { routeWithAuto: false, requestedAuto: null };
}

const TOOL_MAX_STEPS = Math.min(32, Math.max(1, Number(process.env.CHAT_TOOL_MAX_STEPS) || 12));
/**
 * A chat turn as it travels through this route.
 *
 * The client payload, a revived DB row and an AI SDK response message all decode
 * into this envelope. Only the fields this route reads are named; everything else
 * a provider or client attaches passes through untouched, because the whole
 * message is what gets persisted and replayed to the model.
 */
const chatMessageSchema = z
  .object({
    id: z.string().optional(),
    role: z.string().optional(),
    content: z.unknown(),
    parts: z.unknown(),
  })
  .passthrough();

type ChatMessage = z.infer<typeof chatMessageSchema>;

/** An id or role that survives a round-trip: present, and not just whitespace. */
const presentTextSchema = z.string().trim().min(1);

const isPresentText = (value: string | undefined): value is string =>
  value !== undefined && presentTextSchema.safeParse(value).success;

type RegistryModelId = `${string}:${string}`;

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

/**
 * Normalizes arbitrary incoming message payloads so downstream code can rely on
 * `id` and `role` being present. If a client omits `id`, we stamp one here so
 * the message can still be persisted and deduplicated.
 *
 * NOTE: Clients SHOULD generate a UUID v4 for every message (`message.id`) before
 * sending it. This enables optimistic UI updates and allows the server to
 * deduplicate retries safely.
 */
function normalizeMessage(message: ChatMessage): ChatMessage | null {
  if (!isPresentText(message.role)) {
    return null;
  }

  return isPresentText(message.id) ? message : { ...message, id: randomUUID() };
}

/**
 * Rehydrates a stored DB record back into the AI SDK-friendly envelope. The DB
 * always stores the original JSON, but `messageId`/`role` are kept separately as
 * an escape hatch if the payload ever changes shape.
 */
function reviveStoredMessage(record: StoredMessageRecord): ChatMessage {
  const stored = chatMessageSchema.safeParse(record.content);
  if (stored.success) {
    return {
      ...stored.data,
      id: presentTextSchema.safeParse(stored.data.id).success ? stored.data.id : record.messageId,
      role: presentTextSchema.safeParse(stored.data.role).success ? stored.data.role : record.role,
    };
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
function mergeMessages(stored: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) {
    return stored;
  }

  const seenIds = new Set(stored.map((message) => message.id).filter(isPresentText));

  const merged = [...stored];

  for (const message of incoming) {
    if (!isPresentText(message.id)) {
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
function llmPromptSizeHints(system: string | undefined, messages: ChatMessage[]) {
  const systemChars = system?.length ?? 0;
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

/**
 * Rough token estimate (chars/4) for a set of retrieved RAG chunks, used by
 * Phase 1 rule5's "long RAG context" threshold (rules.ts). Shared between
 * the router's own RAG prefetch (routerRagPrefetch, routeWithAuto only) and
 * the plain course-mode RAG path (courseRagHits, every course-scoped
 * request) so both surface the same field with the same formula.
 */
export function ragContextTokenEstimateForCourseRagHits(hits: HybridRagHit[]): number {
  return hits.reduce((acc, hit) => acc + Math.ceil(hit.content.length / 4), 0);
}

/** Serializes a message object to JSON, handling circular references. */
function serializeMessage(message: ChatMessage): Prisma.InputJsonValue {
  try {
    // SAFETY: a structured clone of an already-JSON-decoded message is plain
    // JSON data, so the clone is by construction a `Prisma.InputJsonValue`.
    return structuredClone(message) as Prisma.InputJsonValue;
  } catch {
    // A circular reference is the only way to get here; the JSON round-trip
    // drops it and returns plain JSON data, which needs no assertion.
    return JSON.parse(JSON.stringify(message));
  }
}

/**
 * Assistant content as the AI SDK writes it: already-plain text, or an array of
 * typed parts where only the `text` parts carry anything renderable.
 */
const assistantTextSchema = z.union([
  z.string(),
  z.array(z.unknown()).transform((parts) =>
    parts
      .flatMap((part) => {
        const textPart = z.object({ type: z.literal("text"), text: z.string() }).safeParse(part);
        return textPart.success ? [textPart.data.text] : [];
      })
      .join("\n"),
  ),
]);

/**
 * Pulls plain text out of AI-SDK `response.messages` (whose `content` is an
 * array of typed parts) as a fallback for when the `onFinish`/awaited `text`
 * field is empty. Keeps persisted assistant content as a string so chat history
 * restore renders real markdown instead of a blank bubble or raw JSON.
 */
function extractAssistantText(messages: ChatMessage[] | undefined): string {
  if (!messages?.length) return "";
  const collectText = (content: ChatMessage["content"]): string => {
    const text = assistantTextSchema.safeParse(content);
    return text.success ? text.data : "";
  };
  return messages
    .filter((m) => m.role === "assistant")
    .map((m) => collectText(m.content))
    .filter((t) => t.length > 0)
    .join("\n");
}

/** Prisma reports a unique-constraint collision as error code `P2002`. */
const prismaErrorSchema = z.object({ code: z.string() }).catch({ code: "" });

function isUniqueConstraintViolation(cause: unknown): boolean {
  return prismaErrorSchema.parse(cause).code === "P2002";
}

/**
 * Maps an external `(provider, id)` pair to an EduAI user, creating the user +
 * `ExternalUser` record when needed. The canonical EduAI email stays unchanged;
 * we only update the mapping's email for reference.
 *
 * SECURITY (#225 AUTH-01 / AUTH-03): the `(provider, externalUserId)` mapping
 * is the ONLY identity binding here. We never look up an *existing* EduAI
 * account by `proxyUser.email` and inherit its role — that let any delegating
 * caller impersonate an arbitrary instructor/admin merely by naming their
 * email. A brand-new mapping only ever creates a brand-new, least-privilege
 * STUDENT account, and only when the supplied email clears the same bar as
 * self-registration (a real UBC address, with `auth.allowPublicRegistration`
 * on); otherwise we fail closed instead of minting an unvetted account.
 */
async function resolveProxyUser(proxyUser: ProxyUserPayload): Promise<User> {
  const provider = proxyUser.provider?.trim().toLowerCase() || "aitutor";
  const externalUserId = proxyUser.id?.trim();

  if (!externalUserId) {
    throw new Error("proxyUser.id is required");
  }

  const rawEmail = proxyUser.email?.trim().toLowerCase();
  const suppliedEmail = rawEmail && rawEmail.includes("@") ? rawEmail : null;

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
    if (!existingMapping.email && suppliedEmail) {
      await prisma.externalUser.update({
        where: { id: existingMapping.id },
        data: { email: suppliedEmail },
      });
    }
    return existingMapping.user;
  }

  if (!suppliedEmail || !isUbcEmail(suppliedEmail)) {
    throw new Error(
      "proxyUser.email must be a verifiable UBC email address to create a new proxy identity",
    );
  }
  if (!(await getPolicy("auth.allowPublicRegistration"))) {
    throw new Error("Cannot create a new proxy identity while public registration is disabled");
  }

  let user: User;
  try {
    user = await prisma.user.create({
      data: {
        email: suppliedEmail,
        name: suppliedEmail,
        role: UserRole.STUDENT,
        isActive: true,
      },
    });
  } catch (error: unknown) {
    if (isUniqueConstraintViolation(error)) {
      // The email already belongs to an existing EduAI account. Refuse to
      // bind an external identity onto it — that is exactly the AUTH-01
      // escalation path this fix closes.
      throw new Error("An EduAI account with this email already exists");
    }
    throw error;
  }

  try {
    await prisma.externalUser.create({
      data: {
        provider,
        externalUserId,
        email: suppliedEmail,
        userId: user.id,
      },
    });
  } catch (error: unknown) {
    if (isUniqueConstraintViolation(error)) {
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
 * Free-form request context attached to a rejection or stream-error log line.
 * It is a `JsonObject` because every trace is serialized straight to stdout —
 * the same contract the router bags this file forwards already carry.
 */
type ChatTrace = JsonObject;

/**
 * Router and telemetry bags are logged verbatim and never interpreted, so one
 * JSON round-trip is what makes them JSON-shaped — no assertion required, and
 * anything unserializable is dropped here rather than at the log call.
 */
function asTrace<T extends object>(values: T): ChatTrace {
  return JSON.parse(JSON.stringify(values));
}

function formatStreamError(cause: unknown): string {
  return classifyPublicProviderError(cause, "stream").message;
}

function logStreamError(cause: unknown, trace: ChatTrace): void {
  console.error("[chat-api] stream error", {
    error: formatStreamError(cause),
    trace,
    diagnostic: providerErrorDiagnostic(cause),
  });
}

// `chatId` is a required, explicitly-typed parameter (not read out of the
// free-form `trace` bag) so a call site that forgets to pass it is a compile
// error, not a silently-missing X-Chat-Id header on a future gate (#1621
// review) — pass `null` explicitly for the rare case there's genuinely no
// chat yet.
function rejectProviderFailure(
  failure: ProviderFailure,
  chatId: string | null,
  trace: ChatTrace,
): Response {
  const headers = providerFailureHeaders(failure);
  // Surface the chat id back to the client (X-Chat-Id, read in onResponse)
  // even on a provider failure, so a retry continues the same thread instead
  // of spawning another orphaned "New conversation" row (#1561).
  if (chatId) {
    headers["X-Chat-Id"] = chatId;
  }
  return chatApiReject(failure.status, providerFailureBody(failure), trace, headers);
}

function providerStreamErrorMessage(provider: string, cause: unknown, trace: ChatTrace): string {
  logStreamError(cause, trace);
  return JSON.stringify(providerFailureBody(classifyProviderFailure(provider, cause)));
}

function isClientAbort(cause: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  return isProviderAbortError(cause);
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
  const requestStartMs = Date.now();
  // Declared outside the try block (assigned inside, below) so the outer
  // catch-all can still echo X-Chat-Id when an exception outside the
  // explicit provider-failure gates fires after the user's message has
  // already been persisted (#1621 review) — otherwise the client can't
  // resume the same thread on retry even though nothing was lost server-side.
  let chat: Awaited<ReturnType<typeof prisma.chat.findFirst>> = null;
  const activeRequestId = request.headers.get("X-EduAI-Request-Id")?.trim() || null;
  try {
    const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
    if (apiKeyGuard) return apiKeyGuard;

    let session = apiKeySession ?? (await getRequestSession(request));
    let isServiceKeyCaller = false;
    if (!session?.user) {
      const serviceKeyError = await requireServiceKey(request);
      if (serviceKeyError) return serviceKeyError;
      isServiceKeyCaller = true;
      // SAFETY: a service-key caller has no database session, so this stands in
      // for one. Only `session.user.{id,role}` is read past this point, and both
      // are set here; the assertion just borrows the session type's shape.
      session = {
        user: { id: "service", name: "Service", role: "ADMIN" },
      } as typeof session;
    }

    if (!session?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const chatInputLimits = resolveChatInputLimits();
    const bodyResult = await readBoundedChatJson(request, chatInputLimits.maxBodyBytes);
    if (!bodyResult.ok) {
      return new Response(JSON.stringify({ error: bodyResult.error }), {
        status: bodyResult.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    const validationResult = validateChatBody(bodyResult.body, chatInputLimits);
    if (!validationResult.ok) {
      return new Response(JSON.stringify({ error: validationResult.error }), {
        status: validationResult.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    const body = validationResult.body;
    const request_ = chatRequestSchema.parse(body);
    const rawMessages: JsonValue[] = validationResult.messages;
    let model = request_.model?.trim();
    if (model === "") {
      model = undefined;
    }

    // Bedrock is overflow-only (#1441). A client-supplied bedrock:* model
    // would bypass both the local-capacity gate and the global cost cap.
    if (isClientRequestedBedrockModel(model)) {
      return new Response(
        JSON.stringify({
          error:
            'Provider "bedrock" is not directly selectable. It is used only as an overflow target.',
          code: "BEDROCK_NOT_SELECTABLE",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (model === "auto-hybrid") {
      return new Response(
        JSON.stringify({
          error: "Unsupported routing model",
          details:
            'The legacy "auto-hybrid" mode is disabled. Select Auto or Auto (rules) in chat.',
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const routingModelSettings =
      model === undefined || model === "auto" || model === "auto-llm"
        ? await getRoutingModelSettings()
        : null;
    if (model === undefined && routingModelSettings) {
      model = routingModelSettings.autoLlmEnabled
        ? "auto-llm"
        : routingModelSettings.autoRulesEnabled
          ? "auto"
          : undefined;
    }

    if (
      (model === "auto-llm" && !routingModelSettings?.autoLlmEnabled) ||
      (model === "auto" && !routingModelSettings?.autoRulesEnabled)
    ) {
      return new Response(
        JSON.stringify({
          error: "Routing model disabled",
          details: "The selected Auto routing mode is disabled in Admin → AI Models.",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (model === undefined) {
      return new Response(
        JSON.stringify({
          error: "Missing model",
          details:
            "Enable an Auto routing mode in Admin → AI Models or send a concrete provider:modelId.",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const autoRouting = resolveAutoRouting(model);
    const routeWithAuto = autoRouting.routeWithAuto;
    const courseId = request_.courseId;
    const courseCode = request_.courseCode;
    // #1246: re-generate the last turn's response under a different ADHD Assist
    // policy for in-place preview (toggling Assist swaps content, not just
    // styling). Always non-streaming and never persists anything — it requires
    // an existing owned chatId (validated below) and reuses that chat's normal
    // course/RAG/model context, just with `adhdAssist` overridden for this call.
    const regenerateOnly = body.regenerateOnly === true;
    const streaming = regenerateOnly
      ? false
      : body.streaming === undefined
        ? true
        : Boolean(body.streaming);
    const forceHybridRag = body.forceHybridRag === true;
    const chatId = request_.chatId;
    const chatMode = parseChatMode(request_.chatMode);
    const expectedChatbotType = chatbotTypeFromMode(chatMode);
    const jobType = parseJobType(body.routingContext);

    if (regenerateOnly && !chatId) {
      return new Response(JSON.stringify({ error: "regenerateOnly requires an existing chatId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    chatApiTrace("request received", {
      chatMode,
      chatbotType: expectedChatbotType,
      jobType,
      chatId: chatId ?? null,
      model: model ?? null,
      courseCode: courseCode ?? null,
      courseId: courseId ?? null,
      messageCount: rawMessages.length,
      streaming,
      userId: session.user.id,
      userRole: session.user.role,
    });
    const proxyUserPayload: ProxyUserPayload | null = request_.proxyUser ?? null;
    const workloadFeature = parseWorkloadFeature(body.routingContext);

    const hasAdhdAssistField = Object.prototype.hasOwnProperty.call(body, "adhdAssist");
    const adhdAssist = body.adhdAssist === true;

    const hasSystemPromptField = Object.prototype.hasOwnProperty.call(body, "systemPrompt");
    let trimmedSystemPrompt: string | null = null;
    if (request_.systemPrompt !== undefined) {
      trimmedSystemPrompt = sanitizeSystemPrompt(request_.systemPrompt);
    } else if (body.systemPrompt === null) {
      trimmedSystemPrompt = null;
    }

    let actingUser = session.user;
    if (proxyUserPayload) {
      if (!apiKeySession) {
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
      (isServiceKeyCaller ||
        actingUser.role !== UserRole.ADMIN ||
        // Re-check isActive against the DB (#1571): a deactivated admin's live
        // session must not retain admin chat-tools access until it expires.
        !(await isActiveAdminUser(actingUser.id)))
    ) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // #987/#1113: meter every authenticated caller before provider work. The
    // acting user is final here, so approved proxy traffic remains per-user
    // while direct service-key traffic shares a stable non-secret bucket.
    const { limit: chatRateLimit, windowMs: chatRateWindowMs } = getChatRateLimitConfig();
    const rateLimit = await checkRateLimit(
      `chat:${actingUser.id}`,
      chatRateLimit,
      chatRateWindowMs,
    );
    if (rateLimit.limited) {
      const requestContext = getRequestContext(request);
      fireAndForget(
        logSecurityEvent({
          ...getActorContext({ id: actingUser.id, role: actingUser.role }),
          ...requestContext,
          actionCode: "RATE_LIMIT_EXCEEDED",
          outcome: "DENIED",
          entityType: "Chat",
          details: { userId: actingUser.id },
        }),
      );
      return chatApiReject(
        429,
        { error: "RATE_LIMITED", retryAfter: rateLimit.retryAfter },
        { chatMode, userId: actingUser.id },
        { "Retry-After": String(rateLimit.retryAfter) },
      );
    }

    // The client's turns enter the route here: decode each one, then normalize
    // what decoded. Anything that is not a message-shaped object is dropped.
    const normalizedIncomingMessages = filterIncomingClientMessages(
      rawMessages.flatMap((raw) => {
        const decoded = chatMessageSchema.safeParse(raw);
        if (!decoded.success) return [];
        const normalized = normalizeMessage(decoded.data);
        return normalized === null ? [] : [normalized];
      }),
    );

    // Resolve course code to internal ID when needed.
    // Prefer exact match; fall back to common whitespace variants because
    // callers (e.g. QM before coreCourseId pass-through) sometimes send
    // "COSC121" while Core stores "COSC 121". Prefer courseId when available.
    // Single findMany keeps candidate priority without N round-trips; case is
    // insensitive so "cosc121" still resolves.
    let resolvedCourseId: string | null = null;
    if (courseCode) {
      try {
        const candidates = courseCodeLookupCandidates(courseCode);
        if (candidates.length > 0) {
          const rows = await prisma.course.findMany({
            where: {
              code: { in: candidates, mode: "insensitive" },
              deletedAt: null,
            },
            select: { id: true, code: true },
          });
          resolvedCourseId = pickCourseIdByCandidatePriority(candidates, rows);
        }
      } catch (e) {
        console.error("Failed to resolve course by code", e);
      }
    }

    // Load the owned chat up front so a follow-up turn that sends a `chatId`
    // but no `courseId`/`courseCode` can inherit the course from the persisted
    // chat row, instead of failing COURSE_REQUIRED below (#685 review).
    // (`chat` itself is declared above the try block — see the comment there.)
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
    let effectiveCourse: {
      name: string;
      code: string;
      description: string | null;
      responseStyleTags: string[];
      aiInstructions: string | null;
      courseTopics: string[];
      courseScopeGuardrailEnabled: boolean;
    } | null = null;
    if (effectiveCourseId) {
      // Wide row on purpose: the prompt context below reads `name`, `code`,
      // `description`, `responseStyleTags`, `aiInstructions` and
      // `courseScopeGuardrailEnabled` — all outside GATE_COURSE_SELECT.
      const { course, access } = await resolveCourseAccessWithCourse(actingUser, effectiveCourseId);
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
      // Layer A's policy prompt is injected for every course turn (including
      // admin preview), so topics are loaded unconditionally here — gating
      // this fetch the same way the classifier is gated below previously left
      // admin preview rendering "Topics: none listed" even though the policy
      // block was injected. See #1152 review (yta3216).
      let courseTopics: string[] = [];
      try {
        courseTopics = await getCourseTopicNamesCached(effectiveCourseId);
      } catch (error) {
        console.warn("[course-scope] failed to load course topics", error);
      }
      effectiveCourse = {
        name: course.name,
        code: course.code,
        description: course.description ?? null,
        responseStyleTags: course.responseStyleTags ?? [],
        aiInstructions: course.aiInstructions ?? null,
        courseTopics,
        // Defaulted off (was on) for easier testing
        courseScopeGuardrailEnabled: course.courseScopeGuardrailEnabled ?? false,
      };
    }

    // §19 (#1606): a custom system prompt no longer REPLACES the EduAI base
    // prompt for browser callers — it is appended as a subordinate block, so a
    // learner can express a preference without deleting the assistant's
    // identity, the instructor's configured response style, or the
    // course-scope guardrail.
    //
    // Replace stays on the sessionless service-key path only
    // (`isServiceKeyCaller`). Those callers are already ephemeral and skip
    // course-scope, so replace and the rest of that contract stay aligned.
    // An admin API-key session is a real persisted chat — it layers, same as
    // a browser. A Bearer header on a real user session does NOT flip this
    // either; that hybrid used to replace the base while still persisting
    // to the learner chat.
    //
    // AI Tutor and Question Maker do not use this route. They POST to
    // /api/completion, which has no EduAI course default and uses the
    // supplied systemPrompt as-is.
    const replacesBasePrompt = isServiceKeyCaller;

    // #914 producer (guarded, off by default): when QUEUE_ENQUEUE_ENABLED and the
    // request opts in with `enqueue: true`, push the work onto the AI-job queue and
    // return a durable job id instead of streaming. Placed after the same course
    // access gate as sync chat so an enqueue can never bypass authz. Normal chat
    // skips this entirely; the dispatch worker (#168) drains it later.
    if (isEnqueueRequested()) {
      try {
        const { jobId, queuePosition, queueDepth } = await enqueueQuestionGeneration({
          body,
          messages: rawMessages,
          userId: actingUser.id,
          courseId: effectiveCourseId ?? undefined,
          requestedModel: model,
        });
        // 202 carries a live position/depth snapshot (#915); the client polls
        // the status endpoint (#917) for fresher values.
        return new Response(JSON.stringify({ jobId, queuePosition, queueDepth }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        // Queue saturated (#915): an honest rate signal, not a failure — 429
        // with Retry-After so the client backs off and retries.
        if (error instanceof QueueFullError) {
          return chatApiReject(
            429,
            {
              error: "AI job queue is full",
              details: error.message,
              retryAfterSeconds: error.retryAfterSeconds,
            },
            { chatMode, userId: actingUser.id },
            { "Retry-After": String(error.retryAfterSeconds) },
          );
        }
        // Invalid payload is the caller's fault (400); Redis/DB outages are 503
        // (#1112) — never mask an infra outage as a client error.
        const status = httpStatusForEnqueueError(error);
        const isValidationError = error instanceof ZodError;
        return chatApiReject(
          status,
          {
            error: isValidationError
              ? "Invalid AI job payload"
              : status === 503
                ? "Queue unavailable"
                : "Failed to enqueue AI job",
            details: error instanceof Error ? error.message : "Unknown error",
          },
          { chatMode, userId: actingUser.id },
        );
      }
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
    // regenerateOnly is a read-only content preview (#1246) — must never write
    // any field onto the chat, not just adhdAssist (review on #1365).
    if (hasSystemPromptField && !ephemeral && !regenerateOnly) {
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
    if (
      !ephemeral &&
      !regenerateOnly &&
      chat &&
      effectiveCourseId &&
      chat.courseId !== effectiveCourseId &&
      !chat.courseId
    ) {
      chat = await prisma.chat.update({
        where: { id: chat.id },
        data: { courseId: effectiveCourseId },
      });
    }

    // regenerateOnly always sets adhdAssist to request a one-off override — must
    // never persist it as the chat's new stored default (#1246).
    if (
      !ephemeral &&
      !regenerateOnly &&
      hasAdhdAssistField &&
      chat &&
      chat.adhdAssist !== adhdAssist
    ) {
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
      // SAFETY: a stateless turn has no chat row, so this stub stands in for
      // one. `id: null` marks it as unpersisted, and downstream code reads only
      // the five fields set here; the assertion borrows the row type's shape.
      chat = {
        id: null,
        userId: actingUser.id,
        courseId: effectiveCourseId,
        systemPrompt: trimmedSystemPrompt,
        adhdAssist,
      } as NonNullable<typeof chat>;
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
    let modelMessages = prepareBoundedSessionContext(capToolResultsInMessages(trimmedMessages));

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

    if (!routeWithAuto && !model) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const lastUserMessageForRouting = [...trimmedMessages].reverse().find((m) => m.role === "user");
    const lastUserMessageTextForRouting = extractMessageText(lastUserMessageForRouting);
    const imagesPresent = messageHasImageParts(lastUserMessageForRouting);
    // Scan from the end for the last user-role index directly, instead of
    // relying on the reverse().find() above returning the same object
    // reference as trimmedMessages — a lastIndexOf reference lookup would
    // silently return -1 if that upstream logic ever switched to
    // .map()/clone. (Array.prototype.findLastIndex needs ES2023 lib, not
    // available under this project's ES2022 tsconfig target.)
    let lastUserMessageIndex = -1;
    for (let i = trimmedMessages.length - 1; i >= 0; i--) {
      if (trimmedMessages[i].role === "user") {
        lastUserMessageIndex = i;
        break;
      }
    }
    // Bound to the last MAX_COURSE_SCOPE_HISTORY_TURNS messages *before*
    // mapping/extracting text: course-scope-guardrail.ts only keeps the final
    // few turns anyway, so materializing/extracting text for the entire prior
    // chat history on every turn (unbounded for a long conversation) was
    // wasted work on the critical path.
    const recentCourseScopeConversation: CourseScopeConversationTurn[] =
      lastUserMessageIndex > 0
        ? trimmedMessages
            .slice(0, lastUserMessageIndex)
            .slice(-MAX_COURSE_SCOPE_HISTORY_TURNS)
            .flatMap((message): CourseScopeConversationTurn[] => {
              const role = message.role;
              return role === "user" || role === "assistant"
                ? [{ role, content: extractMessageText(message) }]
                : [];
            })
            .filter((turn) => turn.content.trim().length > 0)
        : [];
    const hasCourse = Boolean(effectiveCourseId);
    const courseRagNeeded = needsCourseRag(lastUserMessageTextForRouting, hasCourse);
    const courseScopeContext: CourseScopeContext | null = effectiveCourse
      ? {
          courseName: effectiveCourse.name,
          courseCode: effectiveCourse.code,
          courseDescription: effectiveCourse.description,
          courseTopics: effectiveCourse.courseTopics,
          aiInstructions: effectiveCourse.aiInstructions,
        }
      : null;

    // Course Chat does not expose student image uploads. Reject crafted
    // image-bearing browser turns explicitly instead of retaining a hidden
    // multimodal path that the supported product cannot produce.
    // Admin/service-key integrations retain the existing multimodal routing.
    if (imagesPresent && courseScopeContext && !isServiceKeyCaller && chatMode !== "admin") {
      return new Response(
        JSON.stringify({
          error: "IMAGE_MESSAGE_UNSUPPORTED",
          message: "Course Chat does not support image messages.",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Kick off the course-scope classifier alongside the RAG prefetch below so
    // its round-trip to the tier-1 vLLM host overlaps instead of adding serial
    // latency. Web-app chat only (#skip for admin preview and service-key
    // callers — AI Tutor/Question Maker — per design; QM's generation-style
    // prompts would false-positive against an "off-topic" gate).
    const courseScopeCheckPromise: Promise<CourseScopeVerdict> | null =
      courseScopeGuardrailEnabled() &&
      effectiveCourse?.courseScopeGuardrailEnabled &&
      courseScopeContext &&
      !isServiceKeyCaller &&
      chatMode !== "admin"
        ? resolveCourseScopeVerdict({
            message: lastUserMessageTextForRouting,
            context: courseScopeContext,
            recentConversation: recentCourseScopeConversation,
          })
        : null;

    // §1298: `getPolicy` is a cached DB read keyed only on a static flag name —
    // it does not depend on, and is not depended on by, the model-capability
    // lookup or course-RAG fetch performed below in each branch. Kicked off
    // here (before Auto routing) rather than later so the routing decision
    // itself can gate the web-lookup escalation rule on *effective* tool
    // availability (#1403 review: a rule that escalates to a "tool-capable"
    // tier without checking `VLLM_CHAT_TOOLS`/`chat.webToolsEnabled` picks a
    // tier the caller can't actually call tools on). We only block on it
    // once, right before routing needs the resolved boolean; the admin
    // branch never reads `webToolsEnabled` itself but the promise is already
    // settled for free by the time any branch reaches its own await.
    const webToolsEnabledPromise = getPolicy("chat.webToolsEnabled");

    let ragTopSimilarity: number | null = null;
    let ragChunkCount: number | null = null;
    let ragContextTokenEstimate: number | null = null;
    let routerRagPrefetch: HybridRagHit[] | null = null;

    if (routeWithAuto && effectiveCourseId && lastUserMessageTextForRouting.trim().length > 0) {
      try {
        routerRagPrefetch = await findRelevantContent(
          lastUserMessageTextForRouting,
          effectiveCourseId,
          HYBRID_RAG_MAX_CHUNKS,
          undefined,
          restrictRagToStudentVisible,
          { signal: request.signal },
        );
        ragChunkCount = routerRagPrefetch.length;
        ragTopSimilarity = routerRagPrefetch[0]?.similarity ?? null;
        ragContextTokenEstimate = ragContextTokenEstimateForCourseRagHits(routerRagPrefetch);
      } catch (err) {
        chatApiDebug("Router RAG prefetch failed", { err: formatStreamError(err) });
      }
    }

    let wasAuto = false;
    let routingTier: 1 | 2 | 3 | null = null;
    let routerContext: ChatTrace | null = null;
    let resolvedRouterVersion: string | null = null;

    if (routeWithAuto) {
      // Admin mode never registers web tools (buildChatToolRegistry /
      // webToolsEnabled are non-admin-only — see the admin branch below),
      // so tool-capable web-lookup escalation only makes sense for non-admin
      // chat. Mirrors `useToolCalling`'s gate later in this function
      // (`supportsTools && !effectiveForceHybridRag`) without needing to
      // know the picked model yet: vLLM forces the tool-less hybrid path
      // unless `VLLM_CHAT_TOOLS=1`, regardless of which tier gets picked.
      const toolsEffectivelyAvailable =
        chatMode !== "admin" && (await webToolsEnabledPromise) && isEffectiveToolCallingAvailable();
      const routingContext = {
        courseId: effectiveCourseId,
        courseCode: courseCode ?? null,
        imagesPresent,
        ragTopSimilarity,
        ragChunkCount,
        ragContextTokenEstimate,
        courseRagNeeded,
        toolsEffectivelyAvailable,
      };
      let decision: RouterDecision;
      try {
        decision = await resolveRoutedModel(
          lastUserMessageTextForRouting,
          routingContext,
          autoRouting.modeOverride ? { modeOverride: autoRouting.modeOverride } : undefined,
        );
      } catch (error) {
        const fallbackReason = formatStreamError(error);
        chatApiDebug("Auto routing failed; falling back to rules", {
          err: fallbackReason,
          requestedAuto: autoRouting.requestedAuto,
        });
        decision = await resolveRoutedModelRules(lastUserMessageTextForRouting, routingContext);
        decision.features.fallbackReason = fallbackReason;
      }
      model = decision.modelId;
      wasAuto = true;
      routingTier = decision.tier;
      routerContext = {
        ...decision.features,
        requestedAuto: autoRouting.requestedAuto,
      };
      const declaredRouterVersion = z.string().safeParse(decision.features.routerVersion);
      resolvedRouterVersion = declaredRouterVersion.success
        ? declaredRouterVersion.data
        : activeRouterVersion(autoRouting.modeOverride ?? parseRouterMode(process.env.ROUTER_MODE));
      chatApiDebug("Auto routing resolved model", {
        resolvedModelId: decision.modelId,
        routingTier: decision.tier,
        rule: decision.features.rule,
        requestedAuto: autoRouting.requestedAuto,
      });
    }

    let resolvedModelId = model!;
    const initialParsedModel = parseModelIdentifier(resolvedModelId);
    if (!initialParsedModel) {
      return new Response(
        JSON.stringify({
          error:
            "Invalid model id. Use provider:modelId (e.g. vllm:qwen2.5-7b-instruct). Check Admin → AI Models.",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    let parsedModel = initialParsedModel;
    let telemetryServerId: string | null = null;

    // Auto routing already enforces `requireImages` centrally (finalizePick
    // in router.ts). An explicitly-chosen model (`routeWithAuto === false`,
    // e.g. admin/service-key callers picking a specific provider:modelId)
    // bypassed that check entirely — an image-bearing request could
    // silently reach a text-only model (seeded vLLM tiers default to
    // `supportsImages: false`) with no error. Reject loudly instead of
    // falling back silently, matching Auto routing's fail-closed behavior.
    if (imagesPresent && !routeWithAuto) {
      const activeModel = await resolveActiveChatModel(resolvedModelId);
      if (!activeModel?.supportsImages) {
        return new Response(
          JSON.stringify({
            error: "IMAGE_MODEL_UNSUPPORTED",
            message: `Model "${resolvedModelId}" does not support image inputs. Choose an image-capable model or use Auto routing.`,
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }

    // Persist the user's message(s) now — the request has already cleared
    // every structural/content validation gate above (course-scope image
    // support, model image-capability), so anything that fails from here on
    // (fleet/provider availability, the model call itself) is an
    // infrastructure failure, not a bad request. A provider/availability
    // failure must not silently discard what the user typed and leave
    // behind an empty, unrecoverable "New conversation" row (#1561).
    const existingMessageIds = new Set(
      storedMessages.map((message) => message.id).filter(isPresentText),
    );
    const appendMessages = async (messages: ChatMessage[]) => {
      // Stateless callers never persist messages (no chat row / no real user).
      // regenerateOnly is a read-only content preview (#1246) — never persists.
      if (ephemeral || regenerateOnly || !chat?.id) return;
      if (!messages.length) return;

      const rows: Prisma.ChatMessageCreateManyInput[] = [];

      for (const message of messages) {
        if (!isPresentText(message.role) || !isPresentText(message.id)) {
          continue;
        }

        if (existingMessageIds.has(message.id)) {
          continue;
        }

        const messageToPersist =
          message.role === "assistant"
            ? withResolvedModelMetadata(message, resolvedModelId, wasAuto)
            : message;

        rows.push({
          chatId: chat!.id,
          messageId: message.id,
          role: message.role,
          content: serializeMessage(messageToPersist),
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

    // Persist only client-authored turns (user messages) that remain in the
    // bounded model context. The assistant reply is owned by `onFinish`/the
    // awaited path below, which stores it once under a server id. Clients resend
    // their whole `useChat` transcript every turn, and their assistant copies
    // carry client-generated ids that never match the server id — persisting
    // those here is what duplicated history on restore. Discarding incoming
    // turns that were already trimmed from this request also prevents a caller
    // from turning a single bounded POST into an unbounded storage write.
    const persistableMessageIds = new Set(
      trimmedMessages.map((message) => message.id).filter(isPresentText),
    );
    await appendMessages(
      normalizedIncomingMessages.filter(
        (message) =>
          message.role !== "assistant" &&
          isPresentText(message.id) &&
          persistableMessageIds.has(message.id),
      ),
    );

    // Shared trace fields for the provider/model-availability gates below —
    // each only varies by `stage`, and building it here means chatId can't
    // be forgotten at a future gate the way a hand-copied literal could.
    const providerGateTrace = (stage: string) =>
      asTrace({
        chatMode,
        userId: actingUser.id,
        model: resolvedModelId,
        stage,
      });

    let fleetPick: FleetPick | null = null;
    if (parsedModel.providerId === "vllm" && fleetRoutingEnabled()) {
      try {
        fleetPick = await resolveFleetHost({
          jobType,
          resolvedModelId,
        });
        if (fleetPick) {
          chatApiTrace("fleet host selected", {
            fleetServerId: fleetPick.serverId,
            fleetReason: fleetPick.reason,
            jobType,
            model: resolvedModelId,
          });
        }
      } catch (err) {
        if (err instanceof FleetUnavailableError) {
          return rejectProviderFailure(
            createProviderFailure(parsedModel.providerId, "MODEL_UNAVAILABLE"),
            chat?.id ?? null,
            providerGateTrace("fleet-resolution"),
          );
        }
        throw err;
      }
    }

    routerContext = asTrace({
      ...routerContext,
      ...buildFleetRouterFeatures(workloadFeature, fleetPick),
    });

    // Service key callers (AI Tutor, QM) have no real User row to look up DB
    // settings for (actingUser.id is the synthetic "service" id), so they
    // must still pass apiKeys in the body, same as before the DB migration.
    // Regular users' keys are always loaded from the DB.
    let providerSettingsBase: Awaited<ReturnType<typeof getUserProviderSettings>>;
    let validatedApiKeys: ReturnType<typeof mergeLocalInferenceFromEnv>;
    if (isServiceKeyCaller) {
      if (!z.record(z.string(), z.unknown()).safeParse(body.apiKeys).success) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const apiKeysParsed = clientApiKeysBodySchema.safeParse(body.apiKeys);
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
      providerSettingsBase = toUserProviderSettings(apiKeysParsed.data);
      validatedApiKeys = mergeLocalInferenceFromEnv(
        providerSettingsBase,
        resolvedModelId,
        fleetPick?.baseUrl,
      );
    } else {
      providerSettingsBase = await getUserProviderSettings(actingUser.id);
      validatedApiKeys = mergeLocalInferenceFromEnv(
        providerSettingsBase,
        resolvedModelId,
        fleetPick?.baseUrl,
      );
    }

    if (!validatedApiKeys[parsedModel.providerId]?.isEnabled) {
      const isServerManagedProvider =
        parsedModel.providerId === "vllm" || parsedModel.providerId === "ollama";
      return rejectProviderFailure(
        createProviderFailure(
          parsedModel.providerId,
          isServerManagedProvider ? "PROVIDER_UNAVAILABLE" : "INVALID_PROVIDER_CONFIG",
        ),
        chat?.id ?? null,
        providerGateTrace("provider-configuration"),
      );
    }

    let registry = createAIProviderRegistry(validatedApiKeys);
    const enabledProviders = listEnabledRegistryProviders(validatedApiKeys);

    if (!enabledProviders.includes(parsedModel.providerId)) {
      const isServerManagedProvider =
        parsedModel.providerId === "vllm" || parsedModel.providerId === "ollama";
      return rejectProviderFailure(
        createProviderFailure(
          parsedModel.providerId,
          isServerManagedProvider ? "PROVIDER_UNAVAILABLE" : "INVALID_PROVIDER_CONFIG",
        ),
        chat?.id ?? null,
        providerGateTrace("provider-registry"),
      );
    }

    // Course-scope guardrail: resolve the classifier promise kicked off
    // earlier (alongside the RAG prefetch) and short-circuit before touching
    // the fleet admission slot, energy sidecar, or streamText() at all.
    const courseScopeVerdict = courseScopeCheckPromise ? await courseScopeCheckPromise : null;
    if (courseScopeVerdict?.blocked) {
      const redirectText = buildCourseScopeRedirectMessage(effectiveCourse?.name ?? null);
      await appendMessages([
        withCourseScopeRedirectMetadata({
          id: randomUUID(),
          role: "assistant",
          content: redirectText,
        }),
      ]);
      chatApiDebug("Course scope guardrail redirected turn", {
        chatId: chat.id,
        courseId: effectiveCourseId,
        confidence: courseScopeVerdict.classification?.confidence ?? null,
      });
      // Emit the same routing/admission headers as every other
      // createDataStreamResponse return in this route so a redirected turn's
      // client model badge/routing telemetry isn't blank — that read as an
      // indistinguishable-from-failure routing gap otherwise.
      const redirectHeaders: Record<string, string> = {};
      Object.assign(
        redirectHeaders,
        autoRoutingHeaders(resolvedModelId, routingTier, wasAuto, resolvedRouterVersion),
      );
      if (chat.id) {
        redirectHeaders["X-Chat-Id"] = chat.id;
      }
      if (streaming) {
        return createDataStreamResponse({
          headers: redirectHeaders,
          execute: (dataStream) => {
            dataStream.write(formatDataStreamPart("text", redirectText));
            dataStream.write(formatDataStreamPart("finish_message", { finishReason: "stop" }));
          },
        });
      }
      return new Response(
        JSON.stringify({
          content: redirectText,
          model,
          finishReason: "stop",
          courseCode,
          chatId: chat?.id,
          // Parity with the persisted message (withCourseScopeRedirectMetadata)
          // and the history-restore path (courseScopeRedirectFromMessage): the
          // non-streaming response previously carried no redirect marker even
          // though no model actually ran to produce `content`.
          courseScopeRedirect: true,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...redirectHeaders },
        },
      );
    }

    const lastUserMessage = [...trimmedMessages]
      .reverse()
      .find((message) => message.role === "user");
    const userQuestion = extractMessageText(lastUserMessage);

    let aiModel;
    try {
      aiModel = registry.languageModel(toRegistryModelId(resolvedModelId));
    } catch (err: unknown) {
      return rejectProviderFailure(
        classifyProviderFailure(parsedModel.providerId, err),
        chat?.id ?? null,
        providerGateTrace("model-resolution"),
      );
    }

    const resolvedSystemPrompt =
      trimmedSystemPrompt ?? sanitizeSystemPrompt(chat.systemPrompt) ?? null;

    let streamConfig;
    let supportsTools: boolean;
    let useToolCalling: boolean;
    let toolMaxTokens: number | undefined;
    let courseRagHits: HybridRagHit[] = [];
    let courseRagContextText = "";
    let courseRagInject = false;
    let effectiveForceHybridRag = forceHybridRag;
    // Set in both branches below once `webToolsEnabledPromise` resolves; read
    // later (outside the branch) for debug logging and the
    // X-Web-Tools-Enabled response header.
    let webToolsEnabled: boolean;
    /** Set for admin so we can re-cap after composeSecurityPrompt expands `system`. */
    let adminContextWindow: number | undefined;
    let adminDesiredMaxOutput: number | undefined;

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
          turnId: crypto.randomUUID(),
        },
        chatMode,
      );

      const buildDefaultSystemPrompt = () =>
        buildAdminSystemPrompt({
          customPrompt: resolvedSystemPrompt,
        });

      // Admin mode never reads `webToolsEnabled`, but we still must observe
      // the same rejection semantics as the original serial `await getPolicy`
      // — so it is awaited alongside the model lookup rather than left to
      // float as an unhandled rejection. Both promises were already in
      // flight before this branch started, so this await is effectively free.
      let activeChatModel: Awaited<ReturnType<typeof resolveActiveChatModel>>;
      [webToolsEnabled, activeChatModel] = await Promise.all([
        webToolsEnabledPromise,
        resolveActiveChatModel(model),
      ]);
      supportsTools = activeChatModel?.supportsTools ?? false;
      const contextWindow = resolveModelContextWindow(
        activeChatModel?.maxTokens,
        parsedModel.providerId,
      );
      // 16k windows: tool schemas + multi-step list payloads leave little room.
      // Cap completion aggressively; mid-turn tool results are reserved separately.
      const desiredMaxOutput = Math.min(
        resolveMaxOutputTokens(activeChatModel?.maxTokens, parsedModel.providerId),
        contextWindow <= 16_384 ? 512 : Number.POSITIVE_INFINITY,
      );

      // #1665 review: the full admin registry is 63 tool() entries —
      // estimateToolDefinitionTokens(63) alone (~26.7k tokens) already
      // exceeds the seeded 16k vLLM admin model's context window, and still
      // eats most of a 32k window once system prompt/history/reserve are
      // added. Below that, send only ADMIN_CORE_TOOL_NAMES — the same
      // read+common-write set the default admin system prompt already
      // documents to the model (chat-mode.ts) — so small-context admin chat
      // stays usable instead of unconditionally failing ADMIN_CONTEXT_TOO_LARGE.
      // Larger-context models (OpenAI/Gemini rows) keep the full registry.
      const effectiveAdminTools = contextWindow <= 32_768 ? pickCoreAdminChatTools(tools) : tools;

      // Leave room for the admin tool schemas on small context models.
      const adminSessionBudget =
        contextWindow <= 16_384
          ? Math.floor(contextWindow * ESTIMATED_CHARS_PER_TOKEN * 0.12)
          : contextWindow <= 32_768
            ? Math.floor(contextWindow * ESTIMATED_CHARS_PER_TOKEN * 0.25)
            : undefined;

      const toolResultCapChars = contextWindow <= 16_384 ? 1_200 : 3_000;

      modelMessages = prepareBoundedSessionContext(
        capToolResultsInMessages(trimmedMessages, toolResultCapChars),
        adminSessionBudget
          ? {
              charBudget: adminSessionBudget,
              recentCount: 3,
              digestMaxChars: toolResultCapChars,
            }
          : undefined,
      );

      adminContextWindow = contextWindow;
      adminDesiredMaxOutput = desiredMaxOutput;

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

      const adminMaxSteps = contextWindow <= 16_384 ? Math.min(TOOL_MAX_STEPS, 6) : TOOL_MAX_STEPS;

      // Provisional maxTokens — final cap runs after composeSecurityPrompt below
      // so the security block and tool schemas are included in the budget.
      streamConfig = {
        model: aiModel,
        messages: modelMessages,
        temperature: 0.2,
        maxTokens: desiredMaxOutput,
        maxSteps: adminMaxSteps,
        tools: effectiveAdminTools,
        toolCallStreaming: streaming && parsedModel.providerId !== "vllm",
        system: buildDefaultSystemPrompt(),
      };
    } else {
      // §1431 dependency graph: `webToolsEnabledPromise` (kicked off before the
      // admin/non-admin branch), `getChatModelCapabilities(model)`, and the
      // course-RAG fetch are mutually independent — none consumes another's
      // result, they only share inputs (`model`, `effectiveCourseId`,
      // `userQuestion`) that were already resolved earlier in the request. The
      // original code awaited them one at a time, serializing three
      // network/DB round trips into TTFB. We now fire all three at once and
      // await together.
      //
      // Error-handling parity:
      //   - `getPolicy` (webToolsEnabledPromise) has no local try/catch — a
      //     rejection must still propagate to the outer request handler
      //     exactly as the original serial `await` would. It is included in
      //     `Promise.all` (not `allSettled`) so first-rejection-wins behavior
      //     is preserved.
      //   - `getChatModelCapabilities` already catches its own errors
      //     internally and resolves with a safe fallback — it never rejects.
      //   - The course-RAG fetch must not reject the whole batch (that would
      //     mask getPolicy failures and lose parallel progress). It catches
      //     locally and returns `{ error }` so the consumer can fail closed
      //     with 503 (#225 RAG-01/RAG-02) instead of treating retrieval
      //     outages as zero hits.
      type CourseRagPrefetchResult =
        | { hits: HybridRagHit[]; error?: undefined }
        | { hits: []; error: unknown };
      const courseRagPromise = (async (): Promise<CourseRagPrefetchResult> => {
        if (!(shouldPrefetchCourseRag(hasCourse) && effectiveCourseId)) {
          return { hits: [] };
        }
        if (routerRagPrefetch) {
          return { hits: routerRagPrefetch };
        }
        try {
          const hits = await findRelevantContent(
            userQuestion,
            effectiveCourseId,
            HYBRID_RAG_MAX_CHUNKS,
            undefined,
            restrictRagToStudentVisible,
            { signal: request.signal },
          );
          return { hits };
        } catch (error) {
          console.error("Error prefetching course RAG context:", error);
          return { hits: [], error };
        }
      })();

      let modelCapabilities: Awaited<ReturnType<typeof getChatModelCapabilities>>;
      let courseRagResult: Awaited<typeof courseRagPromise>;
      [webToolsEnabled, modelCapabilities, courseRagResult] = await Promise.all([
        webToolsEnabledPromise,
        getChatModelCapabilities(model),
        courseRagPromise,
      ]);

      const tools = buildChatToolRegistry({
        effectiveCourseId,
        webToolsEnabled,
        restrictToStudentVisible: restrictRagToStudentVisible,
      });
      supportsTools = modelCapabilities.supportsTools;
      effectiveForceHybridRag =
        forceHybridRag ||
        (parsedModel.providerId === "vllm" && process.env.VLLM_CHAT_TOOLS !== "1");
      useToolCalling = supportsTools && !effectiveForceHybridRag;
      toolMaxTokens = resolveToolMaxOutputTokens(modelCapabilities.maxTokens);

      const courseStyleBlock = effectiveCourse
        ? buildCourseResponseStylePrompt(
            effectiveCourse.responseStyleTags,
            effectiveCourse.aiInstructions,
          )
        : "";
      // Layer A: always-on course-scope policy prompt. Stays in effect even
      // when an instructor disables the stricter Layer B classifier for the
      // course, so course chat still behaves like course chat. Service-key
      // callers (AI Tutor/Question Maker) are exempt — their generation-style
      // prompts aren't scoped to "this course" the way browser chat is.
      const courseScopePolicyBlock =
        courseScopeContext && !isServiceKeyCaller
          ? buildCourseScopePolicyPrompt(courseScopeContext)
          : "";

      const eduAiCourseDefaultPrompt = `You are EduAI, a helpful AI assistant for students and faculty at UBC Okanagan (UBCO).

IMPORTANT: You have access to the full conversation history in the messages array. When users ask about previous messages or context, refer to the conversation history provided to you. DO NOT claim you cannot remember past messages.

${LATEST_TURN_FOCUS_INSTRUCTION}

${courseCode ? `Current course context: ${courseCode} (UBCO). Do not ask the user for the course code if it's provided.` : ""}
Be helpful, conversational, and accurate. Use markdown for formatting. For mathematical expressions, use LaTeX delimiters: inline math with $$...$$ and display math with $$...$$ on its own line.`;

      const defaultCourseSystemPrompt = [
        appendCustomInstructions(
          appendCourseStyleToSystemPrompt(
            // Sessionless service-key prompts still REPLACE the base:
            // structured JSON generation cannot carry a tutor persona
            // above it. Admin API-key and browser sessions layer (#1606).
            replacesBasePrompt
              ? (resolvedSystemPrompt ?? eduAiCourseDefaultPrompt)
              : eduAiCourseDefaultPrompt,
            courseStyleBlock,
          ),
          replacesBasePrompt ? null : resolvedSystemPrompt,
        ),
        courseScopePolicyBlock,
      ]
        .filter(Boolean)
        .join("\n\n");

      if (shouldPrefetchCourseRag(hasCourse) && effectiveCourseId) {
        // #225 RAG-01/RAG-02: an exception during retrieval means the
        // embedding path failed (stale dimension vs. corpus, or provider
        // down) — never treat it like a legitimate zero-hit result. Any
        // failed course prefetch must fail closed: prompts that the intent
        // heuristic skips (e.g. "Explain polymorphism") can still inject
        // via strong similarity when retrieval succeeds, so gating 503 on
        // courseRagNeeded would still answer ungrounded. Deliberately
        // skipped retrieval never enters the promise body (see
        // shouldPrefetchCourseRag).
        if (courseRagResult.error !== undefined) {
          return chatApiReject(
            503,
            {
              error: "Course materials could not be searched right now. Please try again shortly.",
              code: classifyRagRetrievalError(courseRagResult.error),
            },
            { chatMode, userId: actingUser.id, chatId: chat?.id ?? null },
          );
        }
        courseRagHits = courseRagResult.hits;
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
        const eduAiToolBasePrompt = `You are EduAI, a helpful AI assistant for students and faculty at UBC Okanagan (UBCO).

IMPORTANT: You have access to the full conversation history in the messages array. When users ask about previous messages or context, refer to the conversation history provided to you. DO NOT claim you cannot remember past messages.

${LATEST_TURN_FOCUS_INSTRUCTION}`;

        const baseSystemPrompt = [
          appendCustomInstructions(
            appendCourseStyleToSystemPrompt(
              replacesBasePrompt
                ? (resolvedSystemPrompt ?? eduAiToolBasePrompt)
                : eduAiToolBasePrompt,
              courseStyleBlock,
            ),
            replacesBasePrompt ? null : resolvedSystemPrompt,
          ),
          courseScopePolicyBlock,
        ]
          .filter(Boolean)
          .join("\n\n");

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

    const maxTokensBeforeLongOutputCap = streamConfig.maxTokens;
    const longOutputCap = capTokensForLongOutputIntent({
      prompt: lastUserText,
      currentMaxTokens: streamConfig.maxTokens,
      adhdAssist: effectiveAdhdAssist,
    });

    streamConfig.maxTokens = longOutputCap.maxTokens;

    let longOutputCapApplied =
      longOutputCap.isLongOutputIntent && longOutputCap.maxTokens < maxTokensBeforeLongOutputCap;
    const didHitLongOutputCap = (usage: ChatTokenUsage): boolean => {
      const completionTokens = coalesceTokenUsage(usage).completionTokens;

      return didHitAppliedLongOutputCap({
        capApplied: longOutputCapApplied,
        maxTokens: streamConfig.maxTokens,
        completionTokens,
      });
    };

    const priorAssistantText = extractMessageText(
      [...trimmedMessages].reverse().find((message) => message.role === "assistant"),
    );

    let adhdProfile: AdhdTurnProfile | undefined;
    let adhdProfileRequirements: ReturnType<typeof getProfileRequirements> | undefined;

    if (effectiveAdhdAssist) {
      adhdProfile = resolveAdhdTurnProfile({
        userText: lastUserText,
        priorAssistantText,
      });
      adhdProfileRequirements = getProfileRequirements(adhdProfile);
    }

    streamConfig.system = composeSecurityPrompt(
      composeSystemPrompt(streamConfig.system ?? "", {
        adhdAssist: effectiveAdhdAssist,
        profile: adhdProfile,
      }),
    );

    // Re-cap after composeSecurityPrompt so the security block is included, and
    // reserve room for admin tool JSON schemas (a flat 512 allowance under-counts
    // the real registry and blows small windows: ContextWindowExceededError).
    // `toolCount` below reflects whatever was actually attached to
    // streamConfig.tools — the trimmed ADMIN_CORE_TOOL_NAMES set on small
    // windows, or the full registry above 32k (see effectiveAdminTools above).
    if (chatMode === "admin" && adminContextWindow != null && adminDesiredMaxOutput != null) {
      const systemChars = z.string().safeParse(streamConfig.system).success
        ? String(streamConfig.system).length
        : 0;
      let messageChars = 0;
      for (const message of modelMessages) {
        messageChars += estimateMessageCharsForModel(message);
      }
      const declaredTools = z.record(z.string(), z.unknown()).safeParse(streamConfig.tools);
      const toolCount = declaredTools.success ? Object.keys(declaredTools.data).length : 0;
      const toolDefinitionTokens = estimateToolDefinitionTokens(toolCount);
      const toolStepReserve = estimateAdminToolStepReserve(adminContextWindow);
      const estimatedInputTokens =
        estimateTokensFromChars(systemChars + messageChars) +
        toolDefinitionTokens +
        toolStepReserve;

      streamConfig.maxTokens = capMaxOutputTokensForPrompt({
        contextWindow: adminContextWindow,
        estimatedInputTokens,
        desiredMaxOutput: adminDesiredMaxOutput,
        toolDefinitionTokens: 0,
        safetyBuffer: 512,
        minOutput: 256,
      });

      if (longOutputCap.isLongOutputIntent) {
        const adminContextMaxTokens = streamConfig.maxTokens;
        streamConfig.maxTokens = Math.min(adminContextMaxTokens, longOutputCap.maxTokens);
        longOutputCapApplied = streamConfig.maxTokens < adminContextMaxTokens;
      }

      chatApiTrace("max output tokens capped", {
        contextWindow: adminContextWindow,
        estimatedInputTokens,
        toolCount,
        toolDefinitionTokens,
        toolStepReserve,
        desiredMaxOutput: adminDesiredMaxOutput,
        effectiveMaxTokens: streamConfig.maxTokens,
        systemChars,
        messageChars,
      });

      if (
        !promptFitsContextWindow({
          contextWindow: adminContextWindow,
          estimatedInputTokens,
          maxOutputTokens: streamConfig.maxTokens,
          safetyBuffer: 256,
        })
      ) {
        return chatApiReject(
          400,
          {
            error: `Admin chat prompt (system + ${toolCount} tools + history) is too large for this model's ${adminContextWindow}-token context window. Pick a larger-context tool-capable model, start a new chat, or shorten the custom system prompt.`,
            code: "ADMIN_CONTEXT_TOO_LARGE",
            estimatedInputTokens,
            contextWindow: adminContextWindow,
            toolCount,
          },
          { model, chatId: chat?.id ?? null },
        );
      }
    }

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
      // regenerateOnly is a read-only content preview (#1246) — never logs
      // compliance telemetry for a toggled-preview turn.
      if (regenerateOnly) return;
      const trimmed = assistantText?.trim();
      if (!trimmed) return;
      const metrics = computeAdhdResponseMetrics(trimmed, {
        wordCap: adhdWordCap,
      });
      const profileStructuralPass =
        adhdProfile != null ? isProfileStructuralPass(metrics, adhdProfile, trimmed) : undefined;
      void recordResponseComplianceEvent({
        userId: actingUser.id,
        chatId: chat!.id,
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
      forceHybridRag: effectiveForceHybridRag,
      approach: useToolCalling ? "tool_calling" : "hybrid_rag",
      toolMaxTokens: useToolCalling ? toolMaxTokens : undefined,
      longOutputIntent: longOutputCap.isLongOutputIntent,
      effectiveMaxTokens: streamConfig.maxTokens,
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

    const applyBedrockOverflow = (overflow: BedrockOverflowActivation) => {
      resolvedModelId = overflow.resolvedModelId;
      const nextParsed = parseModelIdentifier(resolvedModelId);
      if (!nextParsed) {
        throw new Error(`Invalid Bedrock overflow model id: ${resolvedModelId}`);
      }
      parsedModel = nextParsed;
      model = resolvedModelId;
      telemetryServerId = overflow.serverId;
      fleetPick = null;
      validatedApiKeys = enableBedrockOnSettings(validatedApiKeys);
      registry = createAIProviderRegistry(validatedApiKeys);
      aiModel = registry.languageModel(toRegistryModelId(resolvedModelId));
      streamConfig.model = aiModel;
      routerContext = {
        ...routerContext,
        bedrockOverflow: true,
      };
    };

    const needsAdmission = parsedModel.providerId === "vllm" || parsedModel.providerId === "ollama";
    let admissionRelease: (() => void) | null = null;
    const streamAbortController = new AbortController();
    const abortStreamFromRequest = () => streamAbortController.abort();
    if (request.signal.aborted) abortStreamFromRequest();
    else request.signal.addEventListener("abort", abortStreamFromRequest, { once: true });
    let unregisterCancellation: (() => void) | undefined;
    const cleanupStreamCancellation = () => {
      unregisterCancellation?.();
      unregisterCancellation = undefined;
      request.signal.removeEventListener("abort", abortStreamFromRequest);
    };
    if (activeRequestId) {
      unregisterCancellation = registerActiveChatCancellation(activeRequestId, () => {
        streamAbortController.abort();
      });
    }
    const releaseAdmission = (keepCancellation = false) => {
      if (admissionRelease) {
        admissionRelease();
        admissionRelease = null;
      }
      if (!keepCancellation) cleanupStreamCancellation();
    };
    let admissionWaitedMs = 0;
    if (needsAdmission) {
      try {
        const slot = await acquireAiAdmission(streamAbortController.signal);
        admissionRelease = slot.release;
        admissionWaitedMs = slot.waitedMs;
      } catch (err) {
        if (isClientAbort(err, streamAbortController.signal)) {
          releaseAdmission();
          return clientAbortResponse();
        }
        if (err instanceof AdmissionTimeoutError) {
          const overflow = await tryActivateBedrockOverflow({
            userId: actingUser.id,
          });
          if (overflow) {
            applyBedrockOverflow(overflow);
            chatApiTrace("bedrock overflow after admission timeout", {
              resolvedModelId,
              serverId: overflow.serverId,
            });
          } else {
            releaseAdmission();
            return new Response(
              JSON.stringify({
                error: "Server busy — too many concurrent AI requests. Try again shortly.",
                code: "AI_ADMISSION_TIMEOUT",
              }),
              {
                status: 503,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
        } else {
          releaseAdmission();
          throw err;
        }
      }
    }
    const admissionHeaders = (): Record<string, string> =>
      admissionWaitedMs > 0 ? { "X-Admission-Wait-Ms": String(admissionWaitedMs) } : {};

    /** Headers for the non-streaming JSON turn: content type, admission, fleet. */
    const jsonResponseHeaders = () => {
      const headers: Record<string, string> = {};
      headers["Content-Type"] = "application/json";
      Object.assign(headers, admissionHeaders());
      const fleetServerId = telemetryServerId ?? fleetPick?.serverId;
      if (fleetServerId) {
        headers["X-Fleet-Server"] = fleetServerId;
      }
      return headers;
    };

    const persistTurnTelemetry = async (params: {
      responseText: string;
      usage:
        | {
            promptTokens?: number;
            completionTokens?: number;
            totalTokens?: number;
          }
        | undefined;
      finishReason: string;
    }) => {
      // regenerateOnly is a read-only content preview (#1246) — never
      // persists routing/sustainability telemetry for a toggled-preview turn.
      if (regenerateOnly) return;
      await persistAiInteractionTelemetry({
        userId: actingUser.id,
        courseId: effectiveCourseId,
        resolvedModelId,
        query: lastUserMessageTextForRouting,
        responseText: params.responseText,
        usage: params.usage,
        finishReason: params.finishReason,
        durationMs: Date.now() - requestStartMs,
        wasAuto,
        routingTier,
        routerVersion: wasAuto ? resolvedRouterVersion : null,
        routerFeatures: routerContext,
        serverId: telemetryServerId ?? fleetPick?.serverId ?? null,
        chatId: chat?.id ?? null,
      });
    };

    const fleetStreamProbeMs = parseEnvInt(process.env.FLEET_STREAM_PROBE_MS, 10_000);
    // Probe every fleet vLLM turn (streaming, non-streaming, and oversight) so
    // connection/startup failures throw from runStreamText and Slice 2 can retry.
    // Mid-stream / post-soft-timeout failures after the probe settles are not retried.
    let shouldProbeFleetStream = Boolean(fleetPick) && parsedModel.providerId === "vllm";

    const runStreamText = async () => {
      const probe = shouldProbeFleetStream
        ? createStreamStartupProbe({ timeoutMs: fleetStreamProbeMs })
        : null;
      const streamData = streaming && !needsOversight ? new StreamData() : null;

      // The AI SDK returns synchronously, but several compatible adapters and
      // long-standing route tests return a promise. Normalizing both shapes
      // here also keeps rejected/aborted startup promises inside the existing
      // retry and AbortError handling path.
      const result = await streamText({
        // SAFETY: `streamConfig` is assembled field by field above out of the
        // AI SDK's own values (model, messages, tools, sampling settings); the
        // assertion only re-states that assembly, which the accumulating object
        // type cannot carry on its own.
        ...(streamConfig as Parameters<typeof streamText>[0]),
        providerOptions: usageProviderOptions(parsedModel.providerId),
        abortSignal: streamAbortController.signal,
        onChunk: probe
          ? () => {
              probe.hooks.signalReady();
            }
          : undefined,
        onStepFinish: ({ toolCalls, toolResults }) => {
          probe?.hooks.signalReady();
          if ((toolCalls?.length ?? 0) > 0 || (toolResults?.length ?? 0) > 0) {
            adhdToolsUsed = true;
          }
        },
        onFinish: needsOversight
          ? undefined
          : async ({ text, usage, finishReason, response }) => {
              probe?.hooks.signalReady();
              if (!streaming) {
                return;
              }
              const normalizedUsage = coalesceTokenUsage(tokenUsageSchema.parse(usage));
              await persistTurnTelemetry({
                responseText: text ?? "",
                usage: {
                  promptTokens: normalizedUsage.promptTokens ?? undefined,
                  completionTokens: normalizedUsage.completionTokens ?? undefined,
                  totalTokens: normalizedUsage.totalTokens ?? undefined,
                },
                finishReason: String(finishReason ?? "stop"),
              });
              logResponseCompliance(text, {
                finishReason,
                promptTokens: usage?.promptTokens,
                completionTokens: usage?.completionTokens,
              });
              streamData?.appendMessageAnnotation({
                hitLongOutputCap: didHitLongOutputCap(tokenUsageSchema.parse(usage)),
              });
              void streamData?.close();
              const assistantText = text || extractAssistantText(response?.messages);
              if (assistantText) {
                await appendMessages([
                  {
                    id: randomUUID(),
                    role: "assistant",
                    content: assistantText,
                    metadata: {
                      finishReason,
                      hitLongOutputCap: didHitLongOutputCap(tokenUsageSchema.parse(usage)),
                    },
                  },
                ]).catch((err) => {
                  console.error("[chat-api] failed to persist streaming assistant message", err);
                });
              }
            },
        onError: ({ error }) => {
          logStreamError(error, streamTrace);
          probe?.hooks.signalError(error);
          void streamData?.close();
        },
      });

      if (probe) {
        // streamText() sets up the request lazily: onChunk/onStepFinish only
        // fire once something actually reads the stream. Downstream code
        // doesn't start reading until after this function returns, so without
        // a reader here the probe always falls through to its timeout —
        // it has nothing to be signaled by. Pump a tee'd branch of the
        // stream (fullStream tees a fresh, independent branch per access, so
        // this doesn't steal chunks from the real consumer) purely to drive
        // onChunk while we wait; discard its output. The reader is
        // startup-only: it's canceled as soon as the probe settles so it
        // doesn't keep the tee buffering/consuming for the whole generation.
        const reader = result.fullStream.getReader();
        const pump = (async () => {
          try {
            while (true) {
              const { done } = await reader.read();
              if (done) break;
              // draining only; onChunk/onStepFinish above do the signaling.
            }
          } catch (error) {
            // A rejected probe reader can occur before the SDK emits onError.
            // Surface it immediately so fleet retry does not wait for timeout.
            probe.hooks.signalError(error);
          }
        })();
        try {
          await probe.wait();
        } finally {
          // A tee branch's cancel promise does not settle until its sibling
          // branch also finishes or cancels. Register cancellation, but do not
          // await that promise here: the sibling is the response stream and
          // cannot start until runStreamText returns.
          void reader.cancel().catch(() => {});
          void pump;
        }
      }
      return { result, streamData };
    };

    let result;
    let liveStreamData: StreamData | null = null;
    let fleetRetry = false;
    try {
      ({ result, streamData: liveStreamData } = await runStreamText());
    } catch (error) {
      if (isClientAbort(error, streamAbortController.signal)) {
        releaseAdmission();
        return clientAbortResponse();
      }

      // Slice 2: one inference retry on an alternate healthy fleet host.
      if (fleetPick && parsedModel.providerId === "vllm") {
        const failedPick = fleetPick;
        try {
          const nextPick = await resolveFleetHostAfterFailure({
            failedPick,
            resolvedModelId,
            jobType,
          });
          if (nextPick) {
            fleetPick = nextPick;
            validatedApiKeys = mergeLocalInferenceFromEnv(
              providerSettingsBase,
              resolvedModelId,
              nextPick.baseUrl,
            );
            registry = createAIProviderRegistry(validatedApiKeys);
            aiModel = registry.languageModel(toRegistryModelId(resolvedModelId));
            streamConfig.model = aiModel;
            console.log("[fleet] retry attempt", {
              from: failedPick.serverId,
              to: nextPick.serverId,
              model: resolvedModelId,
            });
            chatApiTrace("fleet retry host selected", {
              fleetServerId: nextPick.serverId,
              fleetReason: nextPick.reason,
              previousServerId: failedPick.serverId,
              fleetRetryAttempt: true,
            });
            ({ result, streamData: liveStreamData } = await runStreamText());
            // #876 success marker — only after the alternate attempt succeeds.
            fleetRetry = true;
            routerContext = {
              ...routerContext,
              ...buildFleetRouterFeatures(workloadFeature, fleetPick),
              fleetRetry: true,
            };
            console.log("[fleet] fleetRetry: true", {
              from: failedPick.serverId,
              to: nextPick.serverId,
              model: resolvedModelId,
            });
          } else {
            const overflow = await tryActivateBedrockOverflow({
              userId: actingUser.id,
            });
            if (!overflow) {
              throw error;
            }
            applyBedrockOverflow(overflow);
            shouldProbeFleetStream = false;
            // The local slot is no longer needed, but the request-specific
            // cancellation handle must survive while the Bedrock fallback
            // stream is running.
            releaseAdmission(true);
            chatApiTrace("bedrock overflow after fleet exhausted", {
              resolvedModelId,
              serverId: overflow.serverId,
              previousServerId: failedPick.serverId,
            });
            ({ result, streamData: liveStreamData } = await runStreamText());
          }
        } catch (retryError) {
          releaseAdmission();
          if (isClientAbort(retryError, streamAbortController.signal)) {
            return clientAbortResponse();
          }
          logStreamError(retryError, streamTrace);
          return rejectProviderFailure(
            classifyProviderFailure(parsedModel.providerId, retryError),
            streamTrace.chatId,
            { ...streamTrace, stage: "stream-startup", fleetRetry },
          );
        }
      } else {
        releaseAdmission();
        logStreamError(error, streamTrace);
        return rejectProviderFailure(
          classifyProviderFailure(parsedModel.providerId, error),
          streamTrace.chatId,
          {
            ...streamTrace,
            stage: "stream-startup",
          },
        );
      }
    }

    if (needsOversight) {
      let draft = "";
      let finalText = "";
      let usage: Awaited<typeof result.usage> | undefined;
      let finishReason: Awaited<typeof result.finishReason> | undefined;
      let sources: Awaited<typeof result.sources> | undefined;
      let reasoning: Awaited<typeof result.reasoning> | undefined;
      let response: Awaited<typeof result.response> | undefined;
      let oversightStage: "provider" | "application" = "provider";

      try {
        // `consumeStream` is an SDK convenience, not part of every compatible
        // provider result. The result promises below are sufficient when it is
        // absent.
        await result.consumeStream?.();

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
              userText: lastUserText,
              priorAssistantText,
              toolsUsed: adhdToolsUsed,
              onlyDeterministic: isAdhdOversightDeterministicOnly(),
            })
          : emptyOversightAuditResult();
        oversightStage = "application";

        finalText = audited.text || draft;
        const normalizedOversightUsage = coalesceTokenUsage(tokenUsageSchema.parse(usage));
        // Both helpers no-op internally for regenerateOnly (#1246) — a
        // read-only content preview shouldn't double-count a turn.
        await persistTurnTelemetry({
          responseText: finalText,
          usage: {
            promptTokens: normalizedOversightUsage.promptTokens ?? undefined,
            completionTokens: normalizedOversightUsage.completionTokens ?? undefined,
            totalTokens: normalizedOversightUsage.totalTokens ?? undefined,
          },
          finishReason: String(finishReason ?? "stop"),
        });
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

          const messagesWithMetadata: ChatMessage[] = toPersist.map((message) => ({
            ...chatMessageSchema.parse(message),
            metadata: {
              finishReason,
              hitLongOutputCap: didHitLongOutputCap(tokenUsageSchema.parse(usage)),
            },
          }));

          if (messagesWithMetadata.length > 0) {
            await appendMessages(messagesWithMetadata);
          }
        };

        if (streaming) {
          const headers: Record<string, string> = {};
          headers["Content-Encoding"] = "none";
          headers["Transfer-Encoding"] = "chunked";
          headers["Connection"] = "keep-alive";
          if (chat?.id) {
            headers["X-Chat-Id"] = chat.id;
          }
          headers["X-Web-Tools-Enabled"] = webToolsEnabled ? "1" : "0";
          Object.assign(
            headers,
            autoRoutingHeaders(
              resolvedModelId,
              routingTier,
              wasAuto,
              resolvedRouterVersion,
              telemetryServerId ?? fleetPick?.serverId ?? null,
            ),
          );

          await persistOverseenAssistantMessages(finalText);

          releaseAdmission();
          return createDataStreamResponse({
            headers: { ...headers, ...admissionHeaders() },
            execute: (dataStream) => {
              if (finalText) {
                dataStream.write(formatDataStreamPart("text", finalText));
              }

              dataStream.writeMessageAnnotation({
                hitLongOutputCap: didHitLongOutputCap(tokenUsageSchema.parse(usage)),
              });

              dataStream.write(
                formatDataStreamPart("finish_message", {
                  finishReason: finishReason ?? "stop",
                }),
              );
            },
          });
        }

        await persistOverseenAssistantMessages(finalText);

        releaseAdmission();
        return new Response(
          JSON.stringify({
            content: finalText,
            model,
            usage,
            finishReason,
            hitLongOutputCap: didHitLongOutputCap(tokenUsageSchema.parse(usage)),
            sources: sources || [],
            reasoning,
            responseId: response?.id,
            courseCode,
            chatId: chat?.id,
            ragTopSimilarity: courseRagHits[0]?.similarity ?? null,
            ragChunkCount: courseRagHits.length,
            ragContextTokenEstimate: ragContextTokenEstimateForCourseRagHits(courseRagHits),
          }),
          { status: 200, headers: jsonResponseHeaders() },
        );
      } catch (error) {
        releaseAdmission();
        if (isClientAbort(error, streamAbortController.signal)) {
          return clientAbortResponse();
        }
        if (oversightStage === "provider") {
          logStreamError(error, streamTrace);
          return rejectProviderFailure(
            classifyProviderFailure(parsedModel.providerId, error),
            streamTrace.chatId,
            { ...streamTrace, stage: "oversight-provider" },
          );
        }
        console.error("Error in ADHD oversight response:", providerErrorDiagnostic(error));
        return new Response(
          JSON.stringify({
            error: "Failed to generate overseen response",
            code: "ADHD_OVERSIGHT_FAILED",
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }

    if (streaming) {
      const headers: Record<string, string> = {};
      headers["Content-Encoding"] = "none";
      headers["Transfer-Encoding"] = "chunked";
      headers["Connection"] = "keep-alive";
      Object.assign(headers, admissionHeaders());
      if (chat?.id) {
        headers["X-Chat-Id"] = chat.id;
      }
      headers["X-Web-Tools-Enabled"] = webToolsEnabled ? "1" : "0";
      Object.assign(
        headers,
        autoRoutingHeaders(
          resolvedModelId,
          routingTier,
          wasAuto,
          resolvedRouterVersion,
          telemetryServerId ?? fleetPick?.serverId ?? null,
        ),
      );
      // `admissionRelease` is cleared below so outer error paths cannot release
      // a slot after ownership transfers to the response body. Capture the
      // acquired callback by value first: closing over `releaseAdmission()` here
      // would read the now-null mutable variable and leak every completed
      // streaming turn until AI_MAX_INFLIGHT is exhausted.
      const acquiredAdmissionRelease = admissionRelease;
      const release = () => {
        acquiredAdmissionRelease?.();
        cleanupStreamCancellation();
      };
      admissionRelease = null;
      const dataStreamOptions: Parameters<typeof result.toDataStreamResponse>[0] = {
        headers,
        // HTTP status/headers are immutable after this 200 stream begins.
        // Publish the same stable provider body through the AI SDK's stream
        // error channel instead of pretending a late failure can be a 502.
        getErrorMessage: (error) =>
          providerStreamErrorMessage(parsedModel.providerId, error, streamTrace),
      };
      if (liveStreamData) {
        dataStreamOptions.data = liveStreamData;
      }
      return withAdmissionRelease(
        result.toDataStreamResponse(dataStreamOptions),
        release,
        streamAbortController.signal,
      );
    } else {
      let providerResultResolved = false;
      try {
        // Some compatible providers expose only the result promises and omit
        // this optional SDK convenience method.
        await result.consumeStream?.();

        const [text, usage, finishReason, sources, reasoning, response] = await Promise.all([
          result.text,
          result.usage,
          result.finishReason,
          result.sources,
          result.reasoning,
          result.response,
        ]);
        providerResultResolved = true;

        if (response?.messages?.length) {
          const assistantMessages: ChatMessage[] = response.messages
            .filter((message) => message.role === "assistant")
            .map((message) => ({
              ...chatMessageSchema.parse(message),
              metadata: {
                finishReason,
                hitLongOutputCap: didHitLongOutputCap(tokenUsageSchema.parse(usage)),
              },
            }));

          await appendMessages(assistantMessages);
        } else {
          const assistantText = text || extractAssistantText(response?.messages);
          if (assistantText) {
            await appendMessages([
              {
                id: randomUUID(),
                role: "assistant",
                content: assistantText,
                metadata: {
                  finishReason,
                  hitLongOutputCap: didHitLongOutputCap(tokenUsageSchema.parse(usage)),
                },
              },
            ]);
          }
        }

        const normalizedUsage = coalesceTokenUsage(tokenUsageSchema.parse(usage));
        // Both helpers no-op internally for regenerateOnly (#1246) — a
        // read-only content preview shouldn't double-count a turn.
        await persistTurnTelemetry({
          responseText: text ?? "",
          usage: {
            promptTokens: normalizedUsage.promptTokens ?? undefined,
            completionTokens: normalizedUsage.completionTokens ?? undefined,
            totalTokens: normalizedUsage.totalTokens ?? undefined,
          },
          finishReason: String(finishReason ?? "stop"),
        });
        // The streaming `onFinish` hook bails out on non-streaming turns, so
        // without this the baseline and prompt-only eval arms (which post
        // `streaming: false` and skip the Dean) record no compliance row at all.
        logResponseCompliance(text ?? "", {
          finishReason,
          promptTokens: usage?.promptTokens,
          completionTokens: usage?.completionTokens,
        });

        releaseAdmission();
        return new Response(
          JSON.stringify({
            content: text,
            model,
            usage,
            finishReason,
            hitLongOutputCap: didHitLongOutputCap(tokenUsageSchema.parse(usage)),
            sources: sources || [],
            reasoning,
            responseId: response?.id,
            courseCode,
            chatId: chat?.id,
            ragTopSimilarity: courseRagHits[0]?.similarity ?? null,
            ragChunkCount: courseRagHits.length,
            ragContextTokenEstimate: ragContextTokenEstimateForCourseRagHits(courseRagHits),
          }),
          { status: 200, headers: jsonResponseHeaders() },
        );
      } catch (error) {
        releaseAdmission();
        if (isClientAbort(error, streamAbortController.signal)) {
          return clientAbortResponse();
        }
        if (!providerResultResolved) {
          logStreamError(error, streamTrace);
          return rejectProviderFailure(
            classifyProviderFailure(parsedModel.providerId, error),
            streamTrace.chatId,
            { ...streamTrace, stage: "non-streaming-provider" },
          );
        }
        console.error("[chat-api] non-streaming response finalization failed", {
          trace: streamTrace,
          diagnostic: providerErrorDiagnostic(error),
        });
        return new Response(
          JSON.stringify({
            error: "Failed to finalize non-streaming response",
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
    console.error("Chat API error:", providerErrorDiagnostic(error));
    // The user's message may already be persisted onto `chat` by the time an
    // unhandled exception reaches here (#1621 review) — echo its id so a
    // client retry continues that thread instead of spawning another one.
    if (chat?.id) {
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json", "X-Chat-Id": chat.id },
      });
    }
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
