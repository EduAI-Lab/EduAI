/**
 * @file Dual-loop AI tutor↔supervisor orchestrator for student-facing guidance.
 *
 * Responsibility: Drives the Socratic-tutoring pipeline. Picks the right prompt
 *   template per mode (teach/guide/custom), calls the EduAI chat endpoint as the
 *   "tutor", then optionally calls it again as the "supervisor" to review and
 *   either approve or revise the tutor's draft. Surfaces only safe responses
 *   (or a curated fallback) back to the student.
 * Callers: Route handlers in `server/src/routes/activities.js` and any other
 *   feature that needs an AI-mediated reply for a student message. Tests
 *   import `_testExports` for unit-level coverage of the pure helpers.
 * Gotchas:
 *   - Per-user provider API keys (apiKeys[provider]) are forwarded to EduAI on
 *     every request and never persisted server-side. The user's Core session
 *     cookie is forwarded as the `Cookie` header — both must be present or
 *     `callEduAI` throws.
 *   - Prompt templates `learning-prompt`, `exercise-prompt`, and
 *     `supervisor-prompt` MUST exist as `PromptTemplate` rows; missing rows
 *     throw and surface as a user-visible error in the catch blocks.
 *   - Supervisor returns JSON; we strip ```json fences then parse, with one
 *     retry on parse failure. After two parse failures we synthesize a
 *     conservative deny-verdict instead of crashing.
 *   - When the supervisor rejects, the next iteration's user message is
 *     prefixed with `[SUPERVISOR FEEDBACK: ...]` so the tutor can self-correct.
 *   - On exhaustion (max iterations w/o approval) we return the supervisor's
 *     last `safeResponseToStudent` rather than the latest unapproved tutor
 *     draft — i.e. we'd rather be vague than leak the answer.
 *   - Iteration cap is configurable per AI model policy (1–5, see
 *     aiModelPolicy.js); supervisor loop is short-circuited when
 *     dualLoopEnabled is false.
 * Related: `aiModelPolicy.js` (iteration/model selection), `eduaiClient.js`
 *   (chat URL + HTTP), `eduaiAuth.js` (cookie extraction),
 *   `routes/activities.js` (HTTP entry points).
 */

import { randomUUID } from "crypto";
import { setTimeout as wait } from "node:timers/promises";
import { prisma } from "../config/database.js";
import { getEduAiCompletionUrl } from "./eduaiClient.js";
import { trimNonEmpty } from "../utils/coreCourseId.js";
import { DEFAULT_TUTOR_MODEL } from "./aiModelPolicy.js";

const SUPERVISOR_ERROR_MESSAGE =
  "AI study buddy encountered an issue reviewing the response. Please try again.";
const FALLBACK_MESSAGE =
  "I'm having trouble formulating a helpful response right now. Please try rephrasing your question, or ask your instructor for guidance.";
const GENERATION_ERROR_MESSAGE = "AI study buddy not available right now. Please try again later.";

function getModelProvider(modelId) {
  if (typeof modelId !== "string") return null;
  const provider = modelId.split(":", 1)[0]?.trim();
  return provider || null;
}

/**
 * Associate BYOK secrets with their real provider. The legacy `apiKey` field
 * is intentionally scoped to the tutor model only; it must never be copied to
 * a supervisor request when policy selects another provider. Callers that
 * have both credentials may pass an `apiKeys` map (provider -> secret), while
 * `supervisorApiKey` is retained as a small compatibility escape hatch for
 * server-side callers.
 */
function resolveProviderApiKeys({
  apiKey,
  apiKeys,
  supervisorApiKey,
  tutorModelId,
  supervisorModelId,
}) {
  const keys = {};
  if (apiKeys && typeof apiKeys === "object" && !Array.isArray(apiKeys)) {
    for (const [provider, value] of Object.entries(apiKeys)) {
      if (typeof value === "string" && value.trim()) keys[provider] = value;
      else if (value && typeof value.apiKey === "string" && value.apiKey.trim()) {
        keys[provider] = value.apiKey;
      }
    }
  }

  const tutorProvider = getModelProvider(tutorModelId);
  const supervisorProvider = getModelProvider(supervisorModelId);
  if (tutorProvider && typeof apiKey === "string" && apiKey.trim()) {
    // The provider-labelled map is authoritative when present. The legacy
    // unlabelled key is only a fallback for callers that have one credential;
    // it is never inserted under any other provider name.
    if (!keys[tutorProvider]) keys[tutorProvider] = apiKey;
  }
  if (supervisorProvider && typeof supervisorApiKey === "string" && supervisorApiKey.trim()) {
    if (!keys[supervisorProvider]) keys[supervisorProvider] = supervisorApiKey;
  }

  return {
    tutorApiKey: tutorProvider ? keys[tutorProvider] || null : null,
    supervisorApiKey: supervisorProvider ? keys[supervisorProvider] || null : null,
    tutorProvider,
    supervisorProvider,
  };
}

// #999/#1001: bound the complete EduAI call, including the one permitted
// retry, so a transient failure cannot turn into an unbounded wait.
const EDUAI_CALL_TIMEOUT_MS = Number(process.env.EDUAI_CALL_TIMEOUT_MS) || 45_000;
const EDUAI_RETRY_DELAY_MS = 250;
const EDUAI_MAX_ATTEMPTS = 2;
const TIMEOUT_MESSAGE = "The AI study buddy took too long to respond. Please try again.";
const SAFE_AI_ERROR_CODES = new Set(["TIMEOUT"]);
const SAFE_AI_LOG_EVENTS = new Set([
  "missing_session_cookie",
  "missing_service_key",
  "missing_user_api_key",
  "invalid_model_id",
  "upstream_retry",
  "upstream_http_error",
  "unexpected_response_format",
  "call_timed_out",
  "call_failed",
  "supervisor_verdict_parse_failed",
  "supervisor_review_failed",
  "teach_response_failed",
  "guide_response_failed",
  "custom_response_failed",
  "guidance_route_failed",
  "custom_route_failed",
]);
const SAFE_AI_LOG_NUMBER_KEYS = ["status", "attempt", "maxAttempts", "durationMs", "timeoutMs"];
const SAFE_AI_LOG_IDENTIFIER_KEYS = ["requestId", "correlationId", "traceId"];
const SAFE_AI_LOG_TYPES = new Set([
  "array",
  "bigint",
  "boolean",
  "function",
  "null",
  "number",
  "object",
  "string",
  "symbol",
  "undefined",
]);
const SAFE_AI_LOG_MODES = new Set(["teach", "guide", "custom"]);

function normalizeDiagnosticIdentifier(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > 128) return undefined;
  return /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(normalized) ? normalized : undefined;
}

function readHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name) || undefined;
  if (typeof headers !== "object") return undefined;

  const matchingKey = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  return matchingKey ? headers[matchingKey] : undefined;
}

function getCorrelationMetadata(headers) {
  return {
    requestId: readHeader(headers, "x-request-id"),
    correlationId: readHeader(headers, "x-correlation-id"),
    traceId: readHeader(headers, "x-trace-id"),
  };
}

function getValueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function sanitizeAiLogMetadata(metadata = {}) {
  const sanitized = {};

  for (const key of SAFE_AI_LOG_NUMBER_KEYS) {
    const value = metadata[key];
    if (Number.isInteger(value) && value >= 0) sanitized[key] = value;
  }

  for (const key of SAFE_AI_LOG_IDENTIFIER_KEYS) {
    const value = normalizeDiagnosticIdentifier(metadata[key]);
    if (value) sanitized[key] = value;
  }

  if (SAFE_AI_LOG_TYPES.has(metadata.responseType)) {
    sanitized.responseType = metadata.responseType;
  }
  if (SAFE_AI_LOG_TYPES.has(metadata.contentType)) {
    sanitized.contentType = metadata.contentType;
  }
  if (SAFE_AI_LOG_MODES.has(metadata.mode)) sanitized.mode = metadata.mode;
  if (SAFE_AI_ERROR_CODES.has(metadata.code)) sanitized.code = metadata.code;

  return sanitized;
}

function getResponseLogMetadata(response, metadata = {}) {
  return sanitizeAiLogMetadata({
    ...metadata,
    status: response?.status,
    ...getCorrelationMetadata(response?.headers),
  });
}

/**
 * Extract only diagnostics that are safe to log or return as correlation
 * metadata. Error messages, stacks, causes, response bodies, URLs, and
 * arbitrary properties are intentionally never copied.
 */
export function getSafeAiErrorMetadata(error, depth = 0) {
  const responseMetadata = sanitizeAiLogMetadata({
    status: error?.response?.status,
    ...getCorrelationMetadata(error?.response?.headers),
  });
  const directMetadata = sanitizeAiLogMetadata({
    status: error?.status,
    code: error?.code,
    requestId: error?.requestId,
    correlationId: error?.correlationId,
    traceId: error?.traceId,
  });
  const causeMetadata =
    depth < 1 && error?.cause && error.cause !== error
      ? getSafeAiErrorMetadata(error.cause, depth + 1)
      : {};

  return sanitizeAiLogMetadata({
    ...causeMetadata,
    ...responseMetadata,
    ...directMetadata,
  });
}

/**
 * Emit one structured, allowlisted AI diagnostic event. The final allowlist
 * drops every field that could carry an error message, body, URL, or stack.
 */
export function logAiGuidanceEvent(level, event, metadata = {}) {
  const safeMetadata = sanitizeAiLogMetadata(metadata);
  const safeEvent = SAFE_AI_LOG_EVENTS.has(event) ? event : "unknown_event";
  const message = `[aiGuidance] ${safeEvent}`;

  if (level === "warn") {
    console.warn(message, safeMetadata);
  } else {
    console.error(message, safeMetadata);
  }

  return safeMetadata;
}

function resolveRetryDelayMs(retryAfter, remainingMs, nowMs = Date.now()) {
  const safeRemainingMs = Math.max(remainingMs, 0);
  let requestedDelayMs = EDUAI_RETRY_DELAY_MS;

  if (typeof retryAfter === "string") {
    const value = retryAfter.trim();

    if (/^-?\d+(?:\.\d+)?$/.test(value)) {
      requestedDelayMs = Number(value) * 1_000;
    } else {
      const retryAt = Date.parse(value);
      if (Number.isFinite(retryAt)) {
        requestedDelayMs = retryAt - nowMs;
      }
    }
  }

  return Math.min(Math.max(requestedDelayMs, 0), safeRemainingMs);
}

function isRetryableEduAiResponse(status, errorText) {
  if (status === 503) {
    return true;
  }

  if (status !== 429) {
    return false;
  }

  // /api/completion currently normalizes provider failures to 502, so a 429
  // here is normally proxy-level. Preserve one retry unless this is the known
  // Core application rate-limit payload, whose window is much longer than the
  // bounded backoff.
  try {
    const coreError = JSON.parse(errorText)?.error;
    return coreError !== "RATE_LIMITED" && coreError !== "Too Many Requests";
  } catch {
    return true;
  }
}

function eduAiErrorMessage(status, errorText) {
  let detail = "";
  try {
    const coreError = JSON.parse(errorText)?.error;
    if (typeof coreError === "string" && coreError.trim()) {
      detail = `: ${coreError.trim()}`;
    }
  } catch {
    // Non-JSON proxy responses keep the established status-only message.
  }
  return `AI API returned status ${status}${detail}`;
}

/**
 * Single logical call to the EduAI chat completion endpoint. Transient 429 or
 * 503 responses receive one bounded retry within the existing timeout.
 *
 * Why both a cookie AND an apiKey: EduAI authenticates the *caller*
 * (this server, on behalf of a logged-in user) via the session cookie, but
 * the actual upstream LLM call is billed against the *user's* personal
 * provider key (OpenAI/Anthropic/Google). The provider key never lands in
 * our DB — it transits straight through to EduAI in the request body.
 */
async function callEduAI({
  systemPrompt,
  userMessage,
  modelId = null,
  cookie,
  userApiKey,
  chatId = null,
  messageId = null,
  courseCode = null,
  // Core Course CUID (AI Tutor `course.coreOfferingId`). Send this for linked
  // offerings so a mismatched/stripped courseCode cannot yield COURSE_REQUIRED
  // (#657 / #1021). Note: Core still resolves `courseCode` first when both are
  // present (`effectiveCourseId = resolvedCourseId || courseId` in chat.ts) —
  // courseId is the fallback when code lookup fails, not a preferred override.
  courseId = null,
  signal,
}) {
  const endpoint = getEduAiCompletionUrl();
  const model = modelId || process.env.EDUAI_MODEL || DEFAULT_TUTOR_MODEL;

  if (!cookie) {
    logAiGuidanceEvent("error", "missing_session_cookie");
    const error = new Error("Session cookie is required for EduAI calls");
    error.status = 401;
    throw error;
  }

  if (!userApiKey) {
    logAiGuidanceEvent("error", "missing_user_api_key");
    const error = new Error("API key is required");
    error.status = 400;
    throw error;
  }

  // Model IDs are namespaced "provider:model" (e.g. "google:gemini-2.5-flash");
  // the provider half indexes into the apiKeys map sent to EduAI.
  const [provider] = model.split(":");
  if (!provider) {
    logAiGuidanceEvent("error", "invalid_model_id");
    throw new Error("Invalid model ID format");
  }

  const userMessageId = messageId || randomUUID();
  const apiKeys = {
    [provider]: {
      apiKey: userApiKey,
      isEnabled: true,
    },
  };

  // Same trim/omit helper as getCoreCourseId — keep one rule for whitespace.
  const trimmedCourseId = trimNonEmpty(courseId);
  const trimmedCourseCode = trimNonEmpty(courseCode);

  const requestBody = {
    messages: [{ id: userMessageId, role: "user", content: userMessage }],
    systemPrompt,
    model,
    apiKeys,
    streaming: false,
    routingContext: { feature: "tutor", jobType: "interactive" },
    // `undefined` is dropped by JSON.stringify, so an unlinked offering sends
    // no key at all rather than an explicit null Core would have to interpret.
    chatId: chatId || undefined,
    courseId: trimmedCourseId ?? undefined,
    courseCode: trimmedCourseCode ?? undefined,
  };

  const callStartedAt = Date.now();

  try {
    const deadline = callStartedAt + EDUAI_CALL_TIMEOUT_MS;
    // The same signal covers both attempts and the backoff, preserving the
    // existing 45-second upper bound for the complete logical call.
    // Attach the shared service key when it is configured. callEduAI posts to
    // /api/completion (not /api/chat): a learner session is enough to auth, and
    // that route already uses the supplied systemPrompt as-is. The bearer is
    // therefore optional here — it matches other Core calls and covers the
    // no-session fallback. A missing key is an operator misconfiguration;
    // throwing would turn it into an opaque tutoring outage, so we log
    // missing_service_key and proceed.
    const serviceKey = process.env.EDUAI_API_KEY;
    if (!serviceKey) {
      logAiGuidanceEvent("error", "missing_service_key");
    }

    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(EDUAI_CALL_TIMEOUT_MS)])
      : AbortSignal.timeout(EDUAI_CALL_TIMEOUT_MS);

    const headers = {
      "Content-Type": "application/json",
      cookie,
    };
    if (serviceKey) {
      headers.Authorization = `Bearer ${serviceKey}`;
    }

    for (let attempt = 1; attempt <= EDUAI_MAX_ATTEMPTS; attempt += 1) {
      const attemptStartedAt = Date.now();
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: requestSignal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const responseMetadata = getResponseLogMetadata(response, {
          attempt,
          maxAttempts: EDUAI_MAX_ATTEMPTS,
          durationMs: Date.now() - attemptStartedAt,
        });
        const shouldRetry =
          isRetryableEduAiResponse(response.status, errorText) && attempt < EDUAI_MAX_ATTEMPTS;

        if (shouldRetry) {
          logAiGuidanceEvent("warn", "upstream_retry", responseMetadata);
          const nowMs = Date.now();
          const remainingMs = Math.max(deadline - nowMs, 0);
          const retryDelayMs = resolveRetryDelayMs(
            response.headers.get("Retry-After"),
            remainingMs,
            nowMs,
          );
          await wait(retryDelayMs, undefined, { signal: requestSignal });
          requestSignal.throwIfAborted();
          if (Date.now() >= deadline) {
            throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
          }
          continue;
        }

        logAiGuidanceEvent("error", "upstream_http_error", responseMetadata);
        const error = new Error(eduAiErrorMessage(response.status, errorText));
        error.status = response.status;
        error.requestId = responseMetadata.requestId;
        error.correlationId = responseMetadata.correlationId;
        error.traceId = responseMetadata.traceId;
        throw error;
      }

      const data = await response.json();
      if (data?.content && typeof data.content === "string") {
        return {
          message: data.content,
          chatId: data.chatId || chatId || null,
        };
      }

      const responseMetadata = getResponseLogMetadata(response, {
        attempt,
        maxAttempts: EDUAI_MAX_ATTEMPTS,
        durationMs: Date.now() - attemptStartedAt,
        responseType: getValueType(data),
        contentType: getValueType(data?.content),
      });
      logAiGuidanceEvent("error", "unexpected_response_format", responseMetadata);
      const error = new Error("Invalid response format from AI API");
      error.requestId = responseMetadata.requestId;
      error.correlationId = responseMetadata.correlationId;
      error.traceId = responseMetadata.traceId;
      throw error;
    }
  } catch (error) {
    if (signal?.aborted) {
      // The caller's own signal (not our timeout) fired — a genuine
      // cancellation, not a timeout. Rethrow as-is so the route layer can
      // detect `signal.aborted` and skip persistence/response-writing
      // instead of mapping it to a 504.
      throw error;
    }
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      logAiGuidanceEvent("error", "call_timed_out", {
        timeoutMs: EDUAI_CALL_TIMEOUT_MS,
        durationMs: Date.now() - callStartedAt,
        ...getSafeAiErrorMetadata(error),
      });
      const timeoutError = new Error(TIMEOUT_MESSAGE);
      timeoutError.status = 504;
      timeoutError.code = "TIMEOUT";
      throw timeoutError;
    }
    logAiGuidanceEvent("error", "call_failed", {
      durationMs: Date.now() - callStartedAt,
      ...getSafeAiErrorMetadata(error),
    });
    throw error;
  }
}

async function getPromptTemplateBySlug(slug) {
  return prisma.promptTemplate.findUnique({ where: { slug } });
}

/**
 * LLMs frequently wrap JSON output in ```json ... ``` fences despite explicit
 * "respond with JSON only" instructions. Stripping the fence before parsing
 * is cheaper and more reliable than retrying.
 */
function stripMarkdownFence(rawText) {
  let value = rawText.trim();
  if (value.startsWith("```")) {
    value = value
      .replace(/```json?\n?/g, "")
      .replace(/```/g, "")
      .trim();
  }
  return value;
}

/**
 * Coerce supervisor JSON into a guaranteed-shape object with safe defaults.
 * Even a partially-valid verdict yields usable feedback + a benign
 * student-facing fallback so callers never need to null-check.
 */
function normalizeSupervisorVerdict(verdict) {
  return {
    approved: Boolean(verdict.approved),
    reason: verdict.reason || "",
    feedbackToTutor:
      verdict.feedbackToTutor ||
      verdict.suggestion ||
      "Revise the response to stay more Socratic and avoid directly revealing the answer.",
    safeResponseToStudent:
      verdict.safeResponseToStudent ||
      "Let’s take one smaller step. Focus on the key concept behind the question and explain which part feels most uncertain.",
  };
}

/**
 * Run the supervisor pass over a tutor draft and return a normalized verdict.
 *
 * Strategy: ask once, parse; on parse failure, ask again with the parse error
 * appended to the prompt so the model can self-correct. After two failed
 * parses we synthesize a conservative deny verdict (approved=false with a
 * generic safe response) — better to be vague than to leak the answer or
 * surface a 5xx to the student.
 */
async function callSupervisor({
  studentMessage,
  visibleContext,
  hiddenContext,
  tutorResponse,
  supervisorModelId,
  cookie,
  userApiKey,
  courseCode = null,
  courseId = null,
  signal,
}) {
  const template = await getPromptTemplateBySlug("supervisor-prompt");
  if (!template) {
    throw new Error("Supervisor prompt template not configured");
  }

  const buildUserMessage = (parseErrorDetails = null) => {
    const base = `VISIBLE STUDENT CONTEXT:
${visibleContext}

HIDDEN REVIEW CONTEXT (NOT FOR TUTOR):
${hiddenContext}

LATEST STUDENT MESSAGE:
${studentMessage}

TUTOR DRAFT RESPONSE:
${tutorResponse}`;

    if (!parseErrorDetails) return base;
    return `${base}

YOUR PREVIOUS RESPONSE WAS NOT VALID JSON.
PARSE ERROR: ${parseErrorDetails}
RESPOND WITH ONLY VALID JSON.`;
  };

  const attemptParse = async (parseErrorDetails = null) => {
    const result = await callEduAI({
      systemPrompt: template.systemPrompt,
      userMessage: buildUserMessage(parseErrorDetails),
      modelId: supervisorModelId,
      cookie,
      userApiKey,
      courseCode,
      courseId,
      signal,
    });

    try {
      const verdict = JSON.parse(stripMarkdownFence(result.message));
      return { ok: true, verdict: normalizeSupervisorVerdict(verdict), raw: result.message };
    } catch (parseError) {
      return { ok: false, parseError, raw: result.message };
    }
  };

  const first = await attemptParse();
  if (first.ok) {
    return { ...first.verdict, parseFailed: false, raw: first.raw };
  }

  const second = await attemptParse(first.parseError?.message || "Invalid JSON");
  if (second.ok) {
    return { ...second.verdict, parseFailed: false, raw: second.raw };
  }

  logAiGuidanceEvent("error", "supervisor_verdict_parse_failed", {
    attempt: 2,
    maxAttempts: 2,
    ...getSafeAiErrorMetadata(second.parseError),
  });
  return {
    approved: false,
    reason: "Supervisor response invalid after retry",
    feedbackToTutor:
      "Revise the reply to avoid revealing the answer and stay focused on a single helpful hint.",
    safeResponseToStudent:
      "Let’s slow down and focus on one clue at a time. Think about which concept the question is really testing before choosing your next step.",
    parseFailed: true,
    raw: second.raw,
  };
}

/**
 * Substitute well-known placeholder tokens in a stored prompt template.
 * Tokens (`[INSERT TOPIC HERE]`, `[ENTER TOPIC]`, `[ENTER KNOWLEDGE LEVEL]`)
 * are a contract with the prompt-template authoring UI — keep in sync if
 * either side changes.
 */
function buildSystemPrompt(templateContent, context = {}) {
  let systemPrompt =
    templateContent ||
    "You are a helpful teaching assistant who guides students toward understanding without revealing answers directly.";

  if (context.topic) {
    systemPrompt = systemPrompt.replace(/\[INSERT TOPIC HERE\]/g, context.topic);
    systemPrompt = systemPrompt.replace(/\[ENTER TOPIC\]/g, context.topic);
  }

  if (context.knowledgeLevel) {
    systemPrompt = systemPrompt.replace(/\[ENTER KNOWLEDGE LEVEL\]/g, context.knowledgeLevel);
  }

  return systemPrompt;
}

function buildTeachUserMessage({ topicName, message }) {
  const topicText = topicName ? `Topic: ${topicName}\n\n` : "";
  return `${topicText}Student request: ${message}`;
}

/**
 * Format the testable question bank as a supervisor-only context block.
 * Answers and choices are included so the supervisor can verify the tutor
 * never reveals them. Returns an empty string when the list is empty.
 */
function buildQuestionBankContext(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return "";

  const lines = [
    "Course Testable Question Bank (supervisor reference only — do not reveal to student):",
  ];
  questions.forEach((q, i) => {
    lines.push(`${i + 1}. [${q.type}, ${q.difficulty}] ${q.content}`);
    if (Array.isArray(q.choices) && q.choices.length > 0) {
      const choiceStr = q.choices.map((c) => `${c.letter}. ${c.text}`).join(", ");
      lines.push(`   Choices: ${choiceStr}`);
    }
    if (q.answer) {
      lines.push(`   Answer: ${q.answer}`);
    }
  });
  return lines.join("\n");
}

/**
 * Render a guide-mode user message: the question, MCQ options (if any), the
 * student's current answer, and the student's natural-language ask. The
 * tutor sees the answer choices but NOT the answer key — that lives in the
 * supervisor's hidden context only.
 */
function buildGuideUserMessage(activity, { message, studentAnswer }) {
  const config = activity.config || {};
  const questionType = config.questionType || "MCQ";
  const question = config.question || activity.instructionsMd || "No question text provided.";

  let base = `Question: ${question}`;
  if (questionType === "MCQ") {
    // Tolerate two historical shapes: `options: [...]` and `options: { choices: [...] }`.
    const options = Array.isArray(config.options)
      ? config.options
      : config.options && Array.isArray(config.options.choices)
        ? config.options.choices
        : [];

    if (options.length > 0) {
      base += "\n\nOptions:\n";
      options.forEach((option, idx) => {
        const letter = String.fromCharCode(65 + idx);
        base += `${letter}. ${option}\n`;
      });
    }
  }

  if (studentAnswer !== null && studentAnswer !== undefined && String(studentAnswer).length > 0) {
    // Numeric answers are MCQ option indices; map to A/B/C/... letters.
    const answerText =
      typeof studentAnswer === "number"
        ? String.fromCharCode(65 + studentAnswer)
        : String(studentAnswer);
    base += `\n\nStudent answer: ${answerText}`;
  }

  base += `\n\nStudent request: ${message}`;
  return base;
}

/**
 * Render the answer key block for the supervisor's hidden context.
 * This text is supervisor-only — the tutor must never see the correct answer
 * for guide-mode questions or it will reveal it.
 */
function formatAnswerKey(activity, studentAnswer) {
  const config = activity.config || {};
  const questionType = config.questionType || "MCQ";

  if (questionType === "MCQ") {
    const correctIndex = config.answer?.correctIndex;
    const options = Array.isArray(config.options)
      ? config.options
      : config.options && Array.isArray(config.options.choices)
        ? config.options.choices
        : [];

    if (typeof correctIndex === "number") {
      const label = String.fromCharCode(65 + correctIndex);
      const answerText = options[correctIndex] ? `${label}. ${options[correctIndex]}` : label;
      return `Correct answer: ${answerText}`;
    }
  }

  if (
    questionType === "SHORT_TEXT" &&
    typeof config.answer?.text === "string" &&
    config.answer.text.trim()
  ) {
    return `Correct answer: ${config.answer.text.trim()}`;
  }

  if (studentAnswer !== null && studentAnswer !== undefined && String(studentAnswer).length > 0) {
    return `Student submitted answer: ${String(studentAnswer)}`;
  }

  return "Correct answer: unavailable";
}

function buildTeachSupervisorContexts({ topicName, knowledgeLevel, message }) {
  const visibleContext = buildTeachUserMessage({ topicName, message });
  const hiddenContext = `${visibleContext}\n\nKnowledge level: ${knowledgeLevel}\n\nThis is a teaching exchange. The tutor should stay concise, encouraging, and avoid doing the student’s thinking for them.`;
  return { visibleContext, hiddenContext };
}

/**
 * Build the visible/hidden context pair for guide-mode supervision. The
 * hidden block injects the answer key — only the supervisor sees this; the
 * tutor receives `visibleContext` (plus optional supervisor feedback).
 */
function buildGuideSupervisorContexts(activity, { knowledgeLevel, message, studentAnswer }) {
  const visibleContext = buildGuideUserMessage(activity, { message, studentAnswer });
  const hiddenContext = `${visibleContext}\n\nKnowledge level: ${knowledgeLevel}\n\nANSWER KEY FOR SUPERVISOR ONLY:\n${formatAnswerKey(
    activity,
    studentAnswer,
  )}`;
  return { visibleContext, hiddenContext };
}

/**
 * The dual-loop driver: ask the tutor, ask the supervisor, repeat up to N
 * times if the supervisor rejects, otherwise short-circuit on first approval
 * or fall back to the supervisor's safe response on exhaustion.
 *
 * Why a `trace` object: every iteration's draft + verdict is captured so the
 * route handler can persist it for instructor review of model behavior.
 *
 * Returned shape always includes a `finalOutcome` discriminator:
 *   - 'single_pass'  — dual-loop disabled, tutor draft returned as-is
 *   - 'approved'     — supervisor approved within iteration budget
 *   - 'safe_fallback'— iterations exhausted, returning supervisor safe text
 *   - 'error'        — set by callers on thrown errors (see catch blocks)
 */
async function supervisedGenerate(generateFn, context) {
  let currentChatId = context.chatId;
  const trace = {
    tutorModelId: context.tutorModelId,
    supervisorModelId: context.supervisorModelId,
    visibleContext: context.visibleContext,
    hiddenContext: context.hiddenContext,
    iterations: [],
    dualLoopEnabled: context.dualLoopEnabled,
    maxSupervisorIterations: context.maxSupervisorIterations,
  };

  // Dual-loop disabled: skip supervision entirely (admin policy override).
  if (!context.dualLoopEnabled) {
    const tutorResult = await generateFn(currentChatId || null, false);
    currentChatId = tutorResult.chatId || currentChatId;
    trace.iterations.push({
      iteration: 1,
      tutorDraft: tutorResult.message,
      supervisorVerdict: null,
    });
    return {
      message: tutorResult.message,
      chatId: currentChatId,
      trace: {
        ...trace,
        finalOutcome: "single_pass",
        finalResponse: tutorResult.message,
        iterationCount: 1,
      },
    };
  }

  // Track the last safe response across iterations so we can return it on
  // exhaustion even if the final supervisor verdict is malformed.
  let lastSafeResponse = FALLBACK_MESSAGE;

  for (let iteration = 0; iteration < context.maxSupervisorIterations; iteration += 1) {
    const isRevision = iteration > 0;
    const tutorResult = await generateFn(currentChatId, isRevision, context.lastFeedback);
    currentChatId = tutorResult.chatId || currentChatId;

    const traceIteration = {
      iteration: iteration + 1,
      tutorDraft: tutorResult.message,
      supervisorVerdict: null,
    };

    try {
      const verdict = await callSupervisor({
        studentMessage: context.originalStudentMessage,
        visibleContext: context.visibleContext,
        hiddenContext: context.hiddenContext,
        tutorResponse: tutorResult.message,
        supervisorModelId: context.supervisorModelId,
        cookie: context.cookie,
        userApiKey: context.supervisorApiKey,
        courseCode: context.courseCode,
        courseId: context.courseId,
        signal: context.signal,
      });

      traceIteration.supervisorVerdict = verdict;
      trace.iterations.push(traceIteration);
      lastSafeResponse = verdict.safeResponseToStudent || lastSafeResponse;

      if (verdict.approved) {
        return {
          message: tutorResult.message,
          chatId: currentChatId,
          trace: {
            ...trace,
            finalOutcome: "approved",
            finalResponse: tutorResult.message,
            iterationCount: trace.iterations.length,
          },
        };
      }

      // Carry feedback into next iteration; generateFn prepends it as
      // `[SUPERVISOR FEEDBACK: ...]` to the user message.
      context.lastFeedback = verdict.feedbackToTutor;
    } catch (supervisorError) {
      logAiGuidanceEvent(
        "error",
        "supervisor_review_failed",
        getSafeAiErrorMetadata(supervisorError),
      );
      throw new Error(SUPERVISOR_ERROR_MESSAGE, { cause: supervisorError });
    }
  }

  return {
    message: lastSafeResponse,
    chatId: currentChatId,
    trace: {
      ...trace,
      finalOutcome: "safe_fallback",
      finalResponse: lastSafeResponse,
      iterationCount: trace.iterations.length,
    },
  };
}

/**
 * Adapter that closes over per-mode prompt + user-message builders and hands
 * them to `supervisedGenerate`. Each public `generate*Response` function
 * funnels through here so the dual-loop semantics are identical across modes.
 */
async function generateWithSupervisor({
  systemPrompt,
  buildUserMessage,
  originalStudentMessage,
  visibleContext,
  hiddenContext,
  tutorModelId,
  supervisorModelId,
  dualLoopEnabled,
  maxSupervisorIterations,
  cookie,
  apiKey,
  apiKeys,
  supervisorApiKey,
  chatId,
  messageId,
  courseCode,
  courseId = null,
  signal,
}) {
  const effectiveTutorModelId = tutorModelId || process.env.EDUAI_MODEL || DEFAULT_TUTOR_MODEL;
  const effectiveSupervisorModelId =
    supervisorModelId || process.env.EDUAI_MODEL || DEFAULT_TUTOR_MODEL;
  const resolvedKeys = resolveProviderApiKeys({
    apiKey,
    apiKeys,
    supervisorApiKey,
    tutorModelId: effectiveTutorModelId,
    supervisorModelId: effectiveSupervisorModelId,
  });
  if (!resolvedKeys.tutorApiKey) {
    const error = new Error("API key is required for the selected tutor provider");
    error.status = 400;
    throw error;
  }

  // A supervisor request is an independent provider call. If its provider
  // has no own credential, safely skip that stage rather than relabelling the
  // tutor secret and sending it to the wrong upstream.
  const supervisionAvailable = Boolean(resolvedKeys.supervisorApiKey);
  const context = {
    originalStudentMessage,
    visibleContext,
    hiddenContext,
    tutorModelId: effectiveTutorModelId,
    supervisorModelId: effectiveSupervisorModelId,
    cookie,
    userApiKey: resolvedKeys.tutorApiKey,
    supervisorApiKey: resolvedKeys.supervisorApiKey,
    chatId,
    dualLoopEnabled: dualLoopEnabled && supervisionAvailable,
    maxSupervisorIterations,
    lastFeedback: null,
    courseCode,
    courseId,
    signal,
  };

  const generateFn = async (currentChatId, isRevision, lastFeedback) => {
    let userMessage = buildUserMessage();

    // On revision passes we inline the supervisor's feedback so the tutor
    // can self-correct without us mutating its system prompt.
    if (isRevision && lastFeedback) {
      userMessage = `[SUPERVISOR FEEDBACK: ${lastFeedback}]\n\n${userMessage}`;
    }

    return callEduAI({
      systemPrompt,
      userMessage,
      modelId: effectiveTutorModelId,
      cookie,
      userApiKey: resolvedKeys.tutorApiKey,
      chatId: currentChatId,
      // Each revision needs a fresh messageId so EduAI doesn't dedupe it as
      // the same turn; only the original turn reuses the caller's messageId.
      messageId: isRevision ? randomUUID() : messageId,
      courseCode,
      courseId,
      signal,
    });
  };

  return supervisedGenerate(generateFn, context);
}

/**
 * Teach mode — open-ended exposition on a topic. Uses `learning-prompt`.
 * Supervisor sees a hidden context augmented with the student's knowledge
 * level so it can flag tutoring that's pitched too high or too low.
 */
export async function generateTeachResponse({
  activity,
  topicName,
  knowledgeLevel,
  message,
  tutorModelId = null,
  supervisorModelId = null,
  dualLoopEnabled = true,
  maxSupervisorIterations = 3,
  cookie,
  apiKey,
  apiKeys,
  supervisorApiKey,
  chatId = null,
  messageId = null,
  courseCode = null,
  courseId = null,
  testableQuestions = [],
  signal,
}) {
  try {
    const template = await getPromptTemplateBySlug("learning-prompt");
    if (!template) {
      throw new Error("Learning prompt template missing");
    }

    const resolvedTopicName = topicName || activity.mainTopic?.name || "the subject";
    const baseUserMessage = buildTeachUserMessage({ topicName: resolvedTopicName, message });
    const { visibleContext, hiddenContext: baseHiddenContext } = buildTeachSupervisorContexts({
      topicName: resolvedTopicName,
      knowledgeLevel,
      message,
    });
    const questionBankContext = buildQuestionBankContext(testableQuestions);
    const hiddenContext = questionBankContext
      ? `${baseHiddenContext}\n\n${questionBankContext}`
      : baseHiddenContext;

    return generateWithSupervisor({
      systemPrompt: buildSystemPrompt(template.systemPrompt, {
        topic: resolvedTopicName,
        knowledgeLevel,
      }),
      buildUserMessage: () => baseUserMessage,
      originalStudentMessage: message,
      visibleContext,
      hiddenContext,
      tutorModelId,
      supervisorModelId,
      dualLoopEnabled,
      maxSupervisorIterations,
      cookie,
      apiKey,
      apiKeys,
      supervisorApiKey,
      chatId,
      messageId,
      courseCode,
      courseId,
      signal,
    });
  } catch (error) {
    logAiGuidanceEvent("error", "teach_response_failed", getSafeAiErrorMetadata(error));
    return {
      message: GENERATION_ERROR_MESSAGE,
      chatId,
      trace: {
        tutorModelId,
        supervisorModelId,
        iterations: [],
        finalOutcome: "error",
        finalResponse: GENERATION_ERROR_MESSAGE,
        iterationCount: 0,
      },
    };
  }
}

/**
 * Guide mode — Socratic help on a graded activity. Uses `exercise-prompt`.
 * Supervisor receives the answer key in its hidden context and is expected
 * to reject any draft that reveals it.
 */
export async function generateGuideResponse({
  activity,
  knowledgeLevel,
  message,
  studentAnswer,
  tutorModelId = null,
  supervisorModelId = null,
  dualLoopEnabled = true,
  maxSupervisorIterations = 3,
  cookie,
  apiKey,
  apiKeys,
  supervisorApiKey,
  chatId = null,
  messageId = null,
  courseCode = null,
  courseId = null,
  testableQuestions = [],
  signal,
}) {
  try {
    const template = await getPromptTemplateBySlug("exercise-prompt");
    if (!template) {
      throw new Error("Exercise prompt template missing");
    }

    const baseUserMessage = buildGuideUserMessage(activity, { message, studentAnswer });
    const { visibleContext, hiddenContext: baseHiddenContext } = buildGuideSupervisorContexts(
      activity,
      { knowledgeLevel, message, studentAnswer },
    );
    const questionBankContext = buildQuestionBankContext(testableQuestions);
    const hiddenContext = questionBankContext
      ? `${baseHiddenContext}\n\n${questionBankContext}`
      : baseHiddenContext;

    return generateWithSupervisor({
      systemPrompt: buildSystemPrompt(template.systemPrompt, {
        topic: activity.mainTopic?.name || "the subject",
        knowledgeLevel,
      }),
      buildUserMessage: () => baseUserMessage,
      originalStudentMessage: message,
      visibleContext,
      hiddenContext,
      tutorModelId,
      supervisorModelId,
      dualLoopEnabled,
      maxSupervisorIterations,
      cookie,
      apiKey,
      apiKeys,
      supervisorApiKey,
      chatId,
      messageId,
      courseCode,
      courseId,
      signal,
    });
  } catch (error) {
    logAiGuidanceEvent("error", "guide_response_failed", getSafeAiErrorMetadata(error));
    return {
      message: GENERATION_ERROR_MESSAGE,
      chatId,
      trace: {
        tutorModelId,
        supervisorModelId,
        iterations: [],
        finalOutcome: "error",
        finalResponse: GENERATION_ERROR_MESSAGE,
        iterationCount: 0,
      },
    };
  }
}

/**
 * Custom mode — instructor-authored prompt overrides the default templates.
 * Throws if `activity.customPrompt` is empty (caller should not have routed
 * here without one). Reuses guide-mode supervisor contexts because custom
 * prompts almost always wrap a graded question.
 */
export async function generateCustomResponse({
  activity,
  topicName,
  knowledgeLevel,
  message,
  studentAnswer,
  tutorModelId = null,
  supervisorModelId = null,
  dualLoopEnabled = true,
  maxSupervisorIterations = 3,
  cookie,
  apiKey,
  apiKeys,
  supervisorApiKey,
  chatId = null,
  messageId = null,
  courseCode = null,
  courseId = null,
  testableQuestions = [],
  signal,
}) {
  try {
    if (!activity.customPrompt) {
      throw new Error("No custom prompt configured for this activity");
    }

    const resolvedTopicName = topicName || activity.mainTopic?.name || "the subject";
    const baseUserMessage = buildGuideUserMessage(activity, { message, studentAnswer });
    const { visibleContext, hiddenContext: baseHiddenContext } = buildGuideSupervisorContexts(
      activity,
      { knowledgeLevel, message, studentAnswer },
    );
    const questionBankContext = buildQuestionBankContext(testableQuestions);
    const hiddenContext = questionBankContext
      ? `${baseHiddenContext}\n\n${questionBankContext}`
      : baseHiddenContext;

    return generateWithSupervisor({
      systemPrompt: buildSystemPrompt(activity.customPrompt, {
        topic: resolvedTopicName,
        knowledgeLevel,
      }),
      buildUserMessage: () => baseUserMessage,
      originalStudentMessage: message,
      visibleContext,
      hiddenContext,
      tutorModelId,
      supervisorModelId,
      dualLoopEnabled,
      maxSupervisorIterations,
      cookie,
      apiKey,
      apiKeys,
      supervisorApiKey,
      chatId,
      messageId,
      courseCode,
      courseId,
      signal,
    });
  } catch (error) {
    logAiGuidanceEvent("error", "custom_response_failed", getSafeAiErrorMetadata(error));
    return {
      message: GENERATION_ERROR_MESSAGE,
      chatId,
      trace: {
        tutorModelId,
        supervisorModelId,
        iterations: [],
        finalOutcome: "error",
        finalResponse: GENERATION_ERROR_MESSAGE,
        iterationCount: 0,
      },
    };
  }
}

// Exposed for unit testing only — not part of the public API.
export const _testExports = {
  resolveRetryDelayMs,
  stripMarkdownFence,
  normalizeSupervisorVerdict,
  buildSystemPrompt,
  buildTeachUserMessage,
  buildGuideUserMessage,
  formatAnswerKey,
  buildTeachSupervisorContexts,
  buildGuideSupervisorContexts,
  buildQuestionBankContext,
};
