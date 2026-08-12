/**
 * Caller-keyed admission controls for Question Maker AI operations.
 *
 * The request limiter is intentionally not the only guard. Some endpoints
 * fan one request out into many provider calls, so every request also reserves
 * its worst-case provider-call cost in a caller-scoped, finite bucket before
 * route/course reads or any upstream work begin.
 */
import rateLimit from 'express-rate-limit';
import { config } from '../config/settings.js';

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const DEFAULT_OPERATION_DEADLINE_MS = 90_000;
const DEFAULT_PROVIDER_CALL_LIMIT = 60;
const DEFAULT_REQUEST_LIMIT = 20;
const DEFAULT_BANK_MAX_QUESTION_IDS = 10;
const DEFAULT_BANK_MAX_VARIANTS_PER_QUESTION = 2;
const DEFAULT_BANK_MAX_PROVIDER_CALLS = 24;
const DEFAULT_REVIEW_MAX_PAIRS = 10;
const DEFAULT_REVIEW_MAX_PROVIDER_CALLS = 21;
const DEFAULT_CHAT_MAX_MESSAGES = 40;
const DEFAULT_CHAT_MAX_MESSAGE_CHARS = 12_000;
const DEFAULT_CHAT_MAX_AGGREGATE_CHARS = 80_000;
const DEFAULT_TEST_BODY_BYTES = 8_192;
const DEFAULT_TEST_PROVIDER_KEY_CHARS = 512;

export const positiveConfigInt = (value, fallback) =>
  Number.isInteger(value) && value > 0 ? value : fallback;

const configInt = (name, fallback) => positiveConfigInt(config?.[name], fallback);

export const qmGeneratePromptMaxChars = () =>
  configInt('qmGeneratePromptMaxChars', 12_000);

export const qmMaxQuestions = () => configInt('maxQuestions', 50);
export const qmAiRateLimitWindowMs = () =>
  configInt('qmAiRateLimitWindowMs', 15 * 60 * 1000);
export const qmAiRateLimitMax = () => configInt('qmAiRateLimitMax', DEFAULT_REQUEST_LIMIT);
export const qmAiProviderCallLimit = () =>
  configInt('qmAiProviderCallLimit', DEFAULT_PROVIDER_CALL_LIMIT);
export const qmAiOperationDeadlineMs = () =>
  configInt('qmAiOperationDeadlineMs', DEFAULT_OPERATION_DEADLINE_MS);

export const qmBankMaxQuestionIds = () =>
  configInt('qmBankMaxQuestionIds', DEFAULT_BANK_MAX_QUESTION_IDS);
export const qmBankMaxVariantsPerQuestion = () =>
  configInt('qmBankMaxVariantsPerQuestion', DEFAULT_BANK_MAX_VARIANTS_PER_QUESTION);
export const qmBankMaxProviderCalls = () =>
  configInt('qmBankMaxProviderCalls', DEFAULT_BANK_MAX_PROVIDER_CALLS);
export const qmReviewMaxPairs = () => configInt('qmReviewMaxPairs', DEFAULT_REVIEW_MAX_PAIRS);
export const qmReviewMaxProviderCalls = () =>
  configInt('qmReviewMaxProviderCalls', DEFAULT_REVIEW_MAX_PROVIDER_CALLS);
export const qmChatMaxMessages = () => configInt('qmChatMaxMessages', DEFAULT_CHAT_MAX_MESSAGES);
export const qmChatMaxMessageChars = () =>
  configInt('qmChatMaxMessageChars', DEFAULT_CHAT_MAX_MESSAGE_CHARS);
export const qmChatMaxAggregateChars = () =>
  configInt('qmChatMaxAggregateChars', DEFAULT_CHAT_MAX_AGGREGATE_CHARS);
export const qmTestApiKeyMaxBodyBytes = () =>
  configInt('qmTestApiKeyMaxBodyBytes', DEFAULT_TEST_BODY_BYTES);
export const qmTestApiKeyMaxProviderKeyChars = () =>
  configInt('qmTestApiKeyMaxProviderKeyChars', DEFAULT_TEST_PROVIDER_KEY_CHARS);

function publicValidation(status, code, message, extra = {}) {
  return { status, code, message, ...extra };
}

function asPositiveSafeInteger(value) {
  if (typeof value === 'string' && !value.trim()) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** Normalize and validate the bounded bank-variant fanout. */
export function validateBankVariantAdmission(body = {}) {
  const questionIds = body && Array.isArray(body.questionIds) ? body.questionIds : null;
  if (!questionIds || questionIds.length === 0) {
    return publicValidation(400, 'QM_BANK_QUESTION_IDS_REQUIRED', 'questionIds is required and must be a non-empty array');
  }

  const maxIds = qmBankMaxQuestionIds();
  if (questionIds.length > maxIds) {
    return publicValidation(
      400,
      'QM_BANK_QUESTION_IDS_TOO_LARGE',
      `questionIds cannot contain more than ${maxIds} ids`,
    );
  }

  const normalizedIds = [];
  const seen = new Set();
  for (const rawId of questionIds) {
    const id = asPositiveSafeInteger(rawId);
    if (id == null) {
      return publicValidation(400, 'QM_BANK_QUESTION_ID_INVALID', 'questionIds must contain finite positive integer ids');
    }
    if (seen.has(id)) {
      return publicValidation(400, 'QM_BANK_QUESTION_IDS_DUPLICATE', 'questionIds must not contain duplicate ids');
    }
    seen.add(id);
    normalizedIds.push(id);
  }

  const rawVariants = body.variantsToAdd == null ? 1 : body.variantsToAdd;
  const variantsToAdd = asPositiveSafeInteger(rawVariants);
  if (variantsToAdd == null) {
    return publicValidation(400, 'QM_BANK_VARIANTS_INVALID', 'variantsToAdd must be a positive integer');
  }
  const maxVariants = qmBankMaxVariantsPerQuestion();
  if (variantsToAdd > maxVariants) {
    return publicValidation(
      400,
      'QM_BANK_VARIANTS_TOO_LARGE',
      `variantsToAdd cannot exceed ${maxVariants}`,
    );
  }

  // A generation attempt may itself perform one JSON repair call, and the
  // bank layer may then perform one MCQ-choice repair generation. Each repair
  // generation may also need its own JSON repair, so reserve four upstream
  // calls per requested variant before reading the question bank.
  const providerCalls = normalizedIds.length * variantsToAdd * 4;
  const maxProviderCalls = qmBankMaxProviderCalls();
  if (providerCalls > maxProviderCalls) {
    return publicValidation(
      400,
      'QM_BANK_PROVIDER_CALL_BUDGET',
      `bank variant request may reserve at most ${maxProviderCalls} provider calls`,
      { questionIds: normalizedIds, variantsToAdd, providerCalls },
    );
  }

  return {
    questionIds: normalizedIds,
    variantsToAdd,
    providerCalls,
    maxQuestionIds: maxIds,
    maxVariantsPerQuestion: maxVariants,
    maxProviderCalls,
  };
}

/** Validate body identifiers before the assessment rows are looked up. */
export function validateReviewAdmission(body = {}) {
  const baselineAssessmentId = asPositiveSafeInteger(body.baselineAssessmentId);
  const variantAssessmentId = asPositiveSafeInteger(body.variantAssessmentId);
  if (baselineAssessmentId == null || variantAssessmentId == null) {
    return publicValidation(
      400,
      'QM_REVIEW_ASSESSMENT_ID_INVALID',
      'baselineAssessmentId and variantAssessmentId must be finite positive integers',
    );
  }
  if (body.includeOverallSummary != null && typeof body.includeOverallSummary !== 'boolean') {
    return publicValidation(400, 'QM_REVIEW_SUMMARY_FLAG_INVALID', 'includeOverallSummary must be boolean');
  }
  return {
    baselineAssessmentId,
    variantAssessmentId,
    includeOverallSummary: body.includeOverallSummary !== false,
    providerCalls: body.includeOverallSummary === false ? 2 * qmReviewMaxPairs() : qmReviewMaxProviderCalls(),
  };
}

/** Validate the finite chat transcript before course resolution or upstream work. */
export function validateChatAdmission(body = {}) {
  const messages = body && Array.isArray(body.messages) ? body.messages : null;
  if (!messages) return publicValidation(400, 'QM_CHAT_MESSAGES_REQUIRED', 'Messages array is required');
  const maxMessages = qmChatMaxMessages();
  if (messages.length > maxMessages) {
    return publicValidation(400, 'QM_CHAT_MESSAGE_COUNT_TOO_LARGE', `messages cannot contain more than ${maxMessages} entries`);
  }

  const maxMessageChars = qmChatMaxMessageChars();
  const maxAggregateChars = qmChatMaxAggregateChars();
  let aggregateChars = 0;
  for (const message of messages) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return publicValidation(400, 'QM_CHAT_MESSAGE_INVALID', 'Each message must be an object');
    }
    if (!['system', 'user', 'assistant'].includes(message.role)) {
      return publicValidation(400, 'QM_CHAT_MESSAGE_ROLE_INVALID', 'Each message role must be system, user, or assistant');
    }
    if (typeof message.content !== 'string') {
      return publicValidation(400, 'QM_CHAT_MESSAGE_CONTENT_INVALID', 'Each message content must be a string');
    }
    if (message.content.length > maxMessageChars) {
      return publicValidation(400, 'QM_CHAT_MESSAGE_TOO_LARGE', `Each message cannot exceed ${maxMessageChars.toLocaleString()} characters`);
    }
    aggregateChars += message.content.length;
    if (aggregateChars > maxAggregateChars) {
      return publicValidation(400, 'QM_CHAT_AGGREGATE_TOO_LARGE', `Chat content cannot exceed ${maxAggregateChars.toLocaleString()} characters`);
    }
  }

  if (typeof body.courseCode !== 'string' || !body.courseCode.trim()) {
    return publicValidation(400, 'QM_CHAT_COURSE_REQUIRED', 'Course code is required');
  }
  return { messages, aggregateChars, maxMessages, maxMessageChars, maxAggregateChars, providerCalls: 1 };
}

const TEST_PROVIDERS = new Set(['google', 'openai', 'deepseek', 'anthropic', 'opencode', 'vllm', 'ollama']);

function providerKeyValue(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && typeof value.apiKey === 'string') return value.apiKey.trim();
  return '';
}

/**
 * Ensure test-api-key can select exactly one provider path and cannot carry an
 * unbounded key/body payload. No catalog probing is allowed by this boundary.
 */
export function validateTestApiKeyAdmission(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return publicValidation(400, 'QM_TEST_API_KEY_BODY_INVALID', 'Request body must be an object');
  }

  let serialized;
  try {
    serialized = JSON.stringify(body);
  } catch {
    return publicValidation(400, 'QM_TEST_API_KEY_BODY_INVALID', 'Request body must be finite JSON');
  }
  if (typeof serialized !== 'string') {
    return publicValidation(400, 'QM_TEST_API_KEY_BODY_INVALID', 'Request body must be finite JSON');
  }
  if (Buffer.byteLength(serialized, 'utf8') > qmTestApiKeyMaxBodyBytes()) {
    return publicValidation(413, 'QM_TEST_API_KEY_BODY_TOO_LARGE', `Request body cannot exceed ${qmTestApiKeyMaxBodyBytes()} bytes`);
  }

  const forceProvider = body.provider == null ? null : String(body.provider).trim().toLowerCase();
  if (forceProvider && !TEST_PROVIDERS.has(forceProvider)) {
    return publicValidation(400, 'QM_TEST_API_KEY_PROVIDER_INVALID', 'provider is not supported');
  }

  const supplied = body.apiKeys == null ? {} : body.apiKeys;
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) {
    return publicValidation(400, 'QM_TEST_API_KEY_KEYS_INVALID', 'apiKeys must be an object');
  }

  const active = [];
  for (const [provider, rawValue] of Object.entries(supplied)) {
    const normalizedProvider = String(provider).trim().toLowerCase();
    if (!TEST_PROVIDERS.has(normalizedProvider)) {
      return publicValidation(400, 'QM_TEST_API_KEY_PROVIDER_INVALID', 'apiKeys contains an unsupported provider');
    }
    const key = providerKeyValue(rawValue);
    if (!key) continue;
    if (key.length > qmTestApiKeyMaxProviderKeyChars()) {
      return publicValidation(413, 'QM_TEST_API_KEY_TOO_LARGE', `Provider keys cannot exceed ${qmTestApiKeyMaxProviderKeyChars()} characters`);
    }
    active.push({ provider: normalizedProvider, value: rawValue });
  }

  if (active.length > 1 || (forceProvider && active.length === 1 && active[0].provider !== forceProvider)) {
    return publicValidation(400, 'QM_TEST_API_KEY_AMBIGUOUS_PROVIDER', 'Select exactly one provider for each probe');
  }
  if (forceProvider && active.length === 0 && !TEST_PROVIDERS.has(forceProvider)) {
    return publicValidation(400, 'QM_TEST_API_KEY_PROVIDER_INVALID', 'provider is not supported');
  }

  return { provider: forceProvider || active[0]?.provider || null, apiKeys: supplied, providerCalls: 1 };
}

/**
 * A caller-scoped provider-call reservation store. Reservations are consumed
 * for the whole window (rather than released on an early failure), preventing
 * fanout retries from turning a single authenticated identity into Core-wide
 * bucket consumption.
 */
const providerReservations = new Map();
const MAX_PROVIDER_RESERVATION_KEYS = 10_000;

function purgeExpiredProviderReservations(now) {
  for (const [key, bucket] of providerReservations) {
    if (bucket.resetAt <= now) providerReservations.delete(key);
  }
}

export function qmAiCallerKey(req) {
  const id = req?.user?.id ?? req?.user?.userId ?? req?.user?.sub;
  return id == null || String(id).trim() === '' ? 'qm-ai:anonymous' : `qm-ai:user:${String(id)}`;
}

export function reserveQmAiProviderCalls(req, cost) {
  const normalizedCost = Number(cost);
  if (!Number.isSafeInteger(normalizedCost) || normalizedCost <= 0) return { ok: false, reason: 'invalid-cost' };

  const now = Date.now();
  const windowMs = qmAiRateLimitWindowMs();
  const key = qmAiCallerKey(req);
  purgeExpiredProviderReservations(now);
  const previous = providerReservations.get(key);
  const bucket = previous && previous.resetAt > now
    ? previous
    : { used: 0, requests: 0, resetAt: now + windowMs };
  const limit = qmAiProviderCallLimit();
  if (bucket.used + normalizedCost > limit) {
    return { ok: false, used: bucket.used, limit, resetAt: bucket.resetAt };
  }
  bucket.used += normalizedCost;
  bucket.requests += 1;
  if (!providerReservations.has(key) && providerReservations.size >= MAX_PROVIDER_RESERVATION_KEYS) {
    // Evict the oldest expired/least-recently-inserted identity rather than
    // allowing attacker-controlled caller ids to grow this process heap.
    const oldest = providerReservations.keys().next().value;
    if (oldest != null) providerReservations.delete(oldest);
  }
  providerReservations.set(key, bucket);
  return { ok: true, used: bucket.used, limit, resetAt: bucket.resetAt };
}

// Test-only reset keeps deterministic suites isolated without exposing the map.
export function resetQmAiAdmissionForTests() {
  providerReservations.clear();
}

function sendAdmissionError(res, validation) {
  const status = Number.isInteger(validation?.status) ? validation.status : 400;
  return res.status(status).json({ success: false, error: validation.message, code: validation.code });
}

/** Reserve a route's worst-case provider-call cost and start its shared deadline. */
export function qmAiProviderCallAdmission({ validate, getCost = (req) => req?.aiAdmission?.providerCalls ?? 1 } = {}) {
  return (req, res, next) => {
    const validation = typeof validate === 'function' ? validate(req.body ?? {}, req) : null;
    if (validation?.status) return sendAdmissionError(res, validation);
    const input = validation || {};
    req.aiAdmission = input;

    const cost = getCost(req, input);
    const reservation = reserveQmAiProviderCalls(req, cost);
    if (!reservation.ok) {
      if (reservation.resetAt) {
        const retryAfter = Math.max(1, Math.ceil((reservation.resetAt - Date.now()) / 1000));
        res.set('Retry-After', String(retryAfter));
      }
      return res.status(429).json({
        success: false,
        error: 'AI provider-call budget exceeded; try again later',
        code: 'QM_AI_PROVIDER_BUDGET_EXCEEDED',
      });
    }

    const controller = new AbortController();
    const deadlineAt = Date.now() + qmAiOperationDeadlineMs();
    const timerDelay = Math.min(qmAiOperationDeadlineMs(), MAX_TIMER_DELAY_MS);
    const timer = setTimeout(() => {
      controller.abort(createQmAiDeadlineError());
    }, timerDelay);
    timer.unref?.();

    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      if (typeof req.off === 'function') req.off('aborted', abortForDisconnect);
      else req.removeListener?.('aborted', abortForDisconnect);
      if (typeof res.off === 'function') {
        res.off('finish', onResponseFinish);
        res.off('close', onResponseClose);
      }
    };
    const abortForDisconnect = () => {
      if (!controller.signal.aborted) controller.abort(new DOMException('Client disconnected', 'AbortError'));
    };
    // `finish` is the normal response lifecycle and must not cancel a request
    // that completed successfully. A `close` without either response-ended
    // marker is a premature client/socket close; abort the actual operation
    // before removing listeners and the deadline timer.
    const onResponseFinish = () => dispose();
    const onResponseClose = () => {
      if (!res.writableEnded && !res.finished) abortForDisconnect();
      dispose();
    };
    if (typeof req.once === 'function') {
      if (req.aborted) abortForDisconnect();
      else req.once('aborted', abortForDisconnect);
    }
    if (typeof res.once === 'function') {
      res.once('finish', onResponseFinish);
      res.once('close', onResponseClose);
    }

    req.aiOperation = {
      signal: controller.signal,
      deadlineAt,
      dispose,
      remainingMs() {
        return Math.max(0, deadlineAt - Date.now());
      },
    };
    next();
  };
}

export function createQmAiDeadlineError() {
  const error = new Error('AI operation deadline exceeded');
  error.name = 'QmAiDeadlineError';
  error.code = 'QM_AI_OPERATION_DEADLINE';
  error.status = 504;
  error.statusCode = 504;
  error.isPublic = true;
  return error;
}

export function isQmAiDeadlineError(error) {
  return error?.code === 'QM_AI_OPERATION_DEADLINE' || error?.name === 'QmAiDeadlineError';
}

export function assertQmAiDeadline({ deadlineAt, signal } = {}) {
  if (signal?.aborted || (Number.isFinite(deadlineAt) && deadlineAt <= Date.now())) {
    throw createQmAiDeadlineError();
  }
  return Number.isFinite(deadlineAt) ? Math.max(0, deadlineAt - Date.now()) : Infinity;
}

export function qmAiCallTimeoutMs({ deadlineAt, requestedMs } = {}) {
  const configured = positiveConfigInt(requestedMs, configInt('qmAiProviderTimeoutMs', 30_000));
  const remaining = assertQmAiDeadline({ deadlineAt });
  return Math.max(1, Math.min(configured, remaining, MAX_TIMER_DELAY_MS));
}

/** A caller-scoped limiter layered on top of the deployment IP limiter. */
export const qmAiUserRateLimit = rateLimit({
  windowMs: qmAiRateLimitWindowMs(),
  max: qmAiRateLimitMax(),
  keyGenerator: (req) => qmAiCallerKey(req),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'AI request limit exceeded; try again later',
  },
});

/** Validate the finite generation budget shared by HTTP routes and services. */
export function validateGenerationBudget({ prompt, numQuestions = 5 } = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return { status: 400, code: 'QM_PROMPT_REQUIRED', message: 'Prompt is required' };
  }

  const maxPromptChars = qmGeneratePromptMaxChars();
  if (prompt.length > maxPromptChars) {
    return {
      status: 413,
      code: 'QM_PROMPT_TOO_LARGE',
      message: `Prompt cannot exceed ${maxPromptChars.toLocaleString()} characters`,
    };
  }

  const resolvedNumQuestions = Number(numQuestions);
  if (!Number.isInteger(resolvedNumQuestions) || resolvedNumQuestions < 1) {
    return { status: 400, code: 'QM_QUESTION_COUNT_INVALID', message: 'numQuestions must be a positive integer' };
  }

  const maxQuestions = qmMaxQuestions();
  if (resolvedNumQuestions > maxQuestions) {
    return { status: 400, code: 'QM_QUESTION_COUNT_TOO_LARGE', message: `numQuestions cannot exceed ${maxQuestions}` };
  }

  return { prompt: prompt.trim(), numQuestions: resolvedNumQuestions, maxPromptChars, maxQuestions };
}

export function generationBudgetError(validation) {
  const error = new Error(validation.message);
  error.status = validation.status;
  error.statusCode = validation.status;
  error.code = validation.code;
  error.isPublic = true;
  return error;
}
