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
 *     every request and never persisted server-side. The user's Better Auth
 *     EduAI OAuth access token is sent as a Bearer header — both must be
 *     present or `callEduAI` throws.
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
 *   (chat URL + HTTP), `eduaiAuth.js` (OAuth token retrieval),
 *   `routes/activities.js` (HTTP entry points).
 */

import { randomUUID } from 'crypto';
import { prisma } from '../config/database.js';
import { getEduAiChatUrl } from './eduaiClient.js';

const SUPERVISOR_ERROR_MESSAGE =
  'AI study buddy encountered an issue reviewing the response. Please try again.';
const FALLBACK_MESSAGE =
  "I'm having trouble formulating a helpful response right now. Please try rephrasing your question, or ask your instructor for guidance.";

/**
 * Single round-trip to the EduAI chat completion endpoint.
 *
 * Why both an OAuth token AND an apiKey: EduAI authenticates the *caller*
 * (this server, on behalf of a logged-in user) via Bearer token, but the
 * actual upstream LLM call is billed against the *user's* personal provider
 * key (OpenAI/Anthropic/Google). The provider key never lands in our DB —
 * it transits straight through to EduAI in the request body.
 */
async function callEduAI({
  systemPrompt,
  userMessage,
  modelId = null,
  eduAiAccessToken,
  userApiKey,
  chatId = null,
  messageId = null,
  courseCode = null,
}) {
  const endpoint = getEduAiChatUrl();
  const model = modelId || process.env.EDUAI_MODEL || 'google:gemini-2.5-flash';

  if (!eduAiAccessToken) {
    console.error('[aiGuidance] Missing EduAI OAuth access token');
    const error = new Error('EduAI OAuth access token is required');
    error.status = 401;
    throw error;
  }

  if (!userApiKey) {
    console.error('[aiGuidance] Missing user API key');
    const error = new Error('API key is required');
    error.status = 400;
    throw error;
  }

  // Model IDs are namespaced "provider:model" (e.g. "google:gemini-2.5-flash");
  // the provider half indexes into the apiKeys map sent to EduAI.
  const [provider] = model.split(':');
  if (!provider) {
    console.error('[aiGuidance] Invalid model ID format:', model);
    throw new Error('Invalid model ID format');
  }

  const userMessageId = messageId || randomUUID();
  const apiKeys = {
    [provider]: {
      apiKey: userApiKey,
      isEnabled: true,
    },
  };

  const requestBody = {
    messages: [{ id: userMessageId, role: 'user', content: userMessage }],
    systemPrompt,
    model,
    apiKeys,
    streaming: false,
    ...(chatId ? { chatId } : {}),
    ...(courseCode ? { courseCode } : {}),
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${eduAiAccessToken}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[aiGuidance] API error:', response.status, errorText);
      const error = new Error(`AI API returned status ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const data = await response.json();
    if (data.content && typeof data.content === 'string') {
      return {
        message: data.content,
        chatId: data.chatId || chatId || null,
      };
    }

    console.error('[aiGuidance] Unexpected response format:', data);
    throw new Error('Invalid response format from AI API');
  } catch (error) {
    console.error('[aiGuidance] Error calling eduAI:', error);
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
  if (value.startsWith('```')) {
    value = value
      .replace(/```json?\n?/g, '')
      .replace(/```/g, '')
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
    reason: verdict.reason || '',
    feedbackToTutor:
      verdict.feedbackToTutor ||
      verdict.suggestion ||
      'Revise the response to stay more Socratic and avoid directly revealing the answer.',
    safeResponseToStudent:
      verdict.safeResponseToStudent ||
      'Let’s take one smaller step. Focus on the key concept behind the question and explain which part feels most uncertain.',
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
  eduAiAccessToken,
  userApiKey,
}) {
  const template = await getPromptTemplateBySlug('supervisor-prompt');
  if (!template) {
    throw new Error('Supervisor prompt template not configured');
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
      eduAiAccessToken,
      userApiKey,
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

  const second = await attemptParse(first.parseError?.message || 'Invalid JSON');
  if (second.ok) {
    return { ...second.verdict, parseFailed: false, raw: second.raw };
  }

  console.error('[supervisor] Failed to parse verdict after retry:', second.raw, second.parseError);
  return {
    approved: false,
    reason: 'Supervisor response invalid after retry',
    feedbackToTutor:
      'Revise the reply to avoid revealing the answer and stay focused on a single helpful hint.',
    safeResponseToStudent:
      'Let’s slow down and focus on one clue at a time. Think about which concept the question is really testing before choosing your next step.',
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
    'You are a helpful teaching assistant who guides students toward understanding without revealing answers directly.';

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
  const topicText = topicName ? `Topic: ${topicName}\n\n` : '';
  return `${topicText}Student request: ${message}`;
}

/**
 * Render a guide-mode user message: the question, MCQ options (if any), the
 * student's current answer, and the student's natural-language ask. The
 * tutor sees the answer choices but NOT the answer key — that lives in the
 * supervisor's hidden context only.
 */
function buildGuideUserMessage(activity, { message, studentAnswer }) {
  const config = activity.config || {};
  const questionType = config.questionType || 'MCQ';
  const question = config.question || activity.instructionsMd || 'No question text provided.';

  let base = `Question: ${question}`;
  if (questionType === 'MCQ') {
    // Tolerate two historical shapes: `options: [...]` and `options: { choices: [...] }`.
    const options = Array.isArray(config.options)
      ? config.options
      : config.options && Array.isArray(config.options.choices)
        ? config.options.choices
        : [];

    if (options.length > 0) {
      base += '\n\nOptions:\n';
      options.forEach((option, idx) => {
        const letter = String.fromCharCode(65 + idx);
        base += `${letter}. ${option}\n`;
      });
    }
  }

  if (studentAnswer !== null && studentAnswer !== undefined && String(studentAnswer).length > 0) {
    // Numeric answers are MCQ option indices; map to A/B/C/... letters.
    const answerText =
      typeof studentAnswer === 'number'
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
  const questionType = config.questionType || 'MCQ';

  if (questionType === 'MCQ') {
    const correctIndex = config.answer?.correctIndex;
    const options = Array.isArray(config.options)
      ? config.options
      : config.options && Array.isArray(config.options.choices)
        ? config.options.choices
        : [];

    if (typeof correctIndex === 'number') {
      const label = String.fromCharCode(65 + correctIndex);
      const answerText = options[correctIndex] ? `${label}. ${options[correctIndex]}` : label;
      return `Correct answer: ${answerText}`;
    }
  }

  if (
    questionType === 'SHORT_TEXT' &&
    typeof config.answer?.text === 'string' &&
    config.answer.text.trim()
  ) {
    return `Correct answer: ${config.answer.text.trim()}`;
  }

  if (studentAnswer !== null && studentAnswer !== undefined && String(studentAnswer).length > 0) {
    return `Student submitted answer: ${String(studentAnswer)}`;
  }

  return 'Correct answer: unavailable';
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
        finalOutcome: 'single_pass',
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
        eduAiAccessToken: context.eduAiAccessToken,
        userApiKey: context.userApiKey,
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
            finalOutcome: 'approved',
            finalResponse: tutorResult.message,
            iterationCount: trace.iterations.length,
          },
        };
      }

      // Carry feedback into next iteration; generateFn prepends it as
      // `[SUPERVISOR FEEDBACK: ...]` to the user message.
      context.lastFeedback = verdict.feedbackToTutor;
    } catch (supervisorError) {
      console.error('[supervisor] Error during review:', supervisorError);
      throw new Error(SUPERVISOR_ERROR_MESSAGE, { cause: supervisorError });
    }
  }

  return {
    message: lastSafeResponse,
    chatId: currentChatId,
    trace: {
      ...trace,
      finalOutcome: 'safe_fallback',
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
  eduAiAccessToken,
  apiKey,
  chatId,
  messageId,
  courseCode,
}) {
  const context = {
    originalStudentMessage,
    visibleContext,
    hiddenContext,
    tutorModelId,
    supervisorModelId,
    eduAiAccessToken,
    userApiKey: apiKey,
    chatId,
    dualLoopEnabled,
    maxSupervisorIterations,
    lastFeedback: null,
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
      modelId: tutorModelId,
      eduAiAccessToken,
      userApiKey: apiKey,
      chatId: currentChatId,
      // Each revision needs a fresh messageId so EduAI doesn't dedupe it as
      // the same turn; only the original turn reuses the caller's messageId.
      messageId: isRevision ? randomUUID() : messageId,
      courseCode,
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
  eduAiAccessToken,
  apiKey,
  chatId = null,
  messageId = null,
  courseCode = null,
}) {
  try {
    const template = await getPromptTemplateBySlug('learning-prompt');
    if (!template) {
      throw new Error('Learning prompt template missing');
    }

    const resolvedTopicName = topicName || activity.mainTopic?.name || 'the subject';
    const baseUserMessage = buildTeachUserMessage({ topicName: resolvedTopicName, message });
    const { visibleContext, hiddenContext } = buildTeachSupervisorContexts({
      topicName: resolvedTopicName,
      knowledgeLevel,
      message,
    });

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
      eduAiAccessToken,
      apiKey,
      chatId,
      messageId,
      courseCode,
    });
  } catch (error) {
    console.error('[aiGuidance] Failed to generate teach response:', error);
    return {
      message: error.message || 'AI study buddy not available right now. Please try again later.',
      chatId,
      trace: {
        tutorModelId,
        supervisorModelId,
        iterations: [],
        finalOutcome: 'error',
        finalResponse:
          error.message || 'AI study buddy not available right now. Please try again later.',
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
  eduAiAccessToken,
  apiKey,
  chatId = null,
  messageId = null,
  courseCode = null,
}) {
  try {
    const template = await getPromptTemplateBySlug('exercise-prompt');
    if (!template) {
      throw new Error('Exercise prompt template missing');
    }

    const baseUserMessage = buildGuideUserMessage(activity, { message, studentAnswer });
    const { visibleContext, hiddenContext } = buildGuideSupervisorContexts(activity, {
      knowledgeLevel,
      message,
      studentAnswer,
    });

    return generateWithSupervisor({
      systemPrompt: buildSystemPrompt(template.systemPrompt, {
        topic: activity.mainTopic?.name || 'the subject',
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
      eduAiAccessToken,
      apiKey,
      chatId,
      messageId,
      courseCode,
    });
  } catch (error) {
    console.error('[aiGuidance] Failed to generate guide response:', error);
    return {
      message: error.message || 'AI study buddy not available right now. Please try again later.',
      chatId,
      trace: {
        tutorModelId,
        supervisorModelId,
        iterations: [],
        finalOutcome: 'error',
        finalResponse:
          error.message || 'AI study buddy not available right now. Please try again later.',
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
  eduAiAccessToken,
  apiKey,
  chatId = null,
  messageId = null,
  courseCode = null,
}) {
  try {
    if (!activity.customPrompt) {
      throw new Error('No custom prompt configured for this activity');
    }

    const resolvedTopicName = topicName || activity.mainTopic?.name || 'the subject';
    const baseUserMessage = buildGuideUserMessage(activity, { message, studentAnswer });
    const { visibleContext, hiddenContext } = buildGuideSupervisorContexts(activity, {
      knowledgeLevel,
      message,
      studentAnswer,
    });

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
      eduAiAccessToken,
      apiKey,
      chatId,
      messageId,
      courseCode,
    });
  } catch (error) {
    console.error('[aiGuidance] Failed to generate custom response:', error);
    return {
      message: error.message || 'AI study buddy not available right now. Please try again later.',
      chatId,
      trace: {
        tutorModelId,
        supervisorModelId,
        iterations: [],
        finalOutcome: 'error',
        finalResponse:
          error.message || 'AI study buddy not available right now. Please try again later.',
        iterationCount: 0,
      },
    };
  }
}

// Exposed for unit testing only — not part of the public API.
export const _testExports = {
  stripMarkdownFence,
  normalizeSupervisorVerdict,
  buildSystemPrompt,
  buildTeachUserMessage,
  buildGuideUserMessage,
  formatAnswerKey,
  buildTeachSupervisorContexts,
  buildGuideSupervisorContexts,
};
