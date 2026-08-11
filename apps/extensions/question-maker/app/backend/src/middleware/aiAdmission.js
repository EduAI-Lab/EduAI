/**
 * Shared admission controls for Question Maker AI operations.
 *
 * Both the legacy provider endpoint and the EduAI proxy are expensive,
 * authenticated operations. Keeping their limits in one module prevents a
 * newer route from accidentally bypassing the prompt/count budget or the
 * caller-keyed rate limiter.
 */
import rateLimit from 'express-rate-limit';
import { config } from '../config/settings.js';

export const positiveConfigInt = (value, fallback) =>
  Number.isInteger(value) && value > 0 ? value : fallback;

export const qmGeneratePromptMaxChars = () =>
  positiveConfigInt(config.qmGeneratePromptMaxChars, 12_000);

export const qmMaxQuestions = () =>
  positiveConfigInt(config.maxQuestions, 50);

/**
 * A caller-scoped limiter is layered on top of the deployment IP limiter. The
 * authenticated identity remains the key, so rotating source IPs cannot
 * bypass the AI budget.
 */
export const qmAiUserRateLimit = rateLimit({
  windowMs: positiveConfigInt(config.qmAiRateLimitWindowMs, 15 * 60 * 1000),
  max: positiveConfigInt(config.qmAiRateLimitMax, 60),
  keyGenerator: (req) => `qm-ai:${req.user?.id ?? req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'AI request limit exceeded; try again later',
  },
});

/**
 * Validates the finite generation budget shared by HTTP routes and services.
 * Returning a descriptor lets routes preserve their normal status/message
 * semantics; service callers can turn the same descriptor into a safe Error.
 */
export function validateGenerationBudget({ prompt, numQuestions = 5 } = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return {
      status: 400,
      code: 'QM_PROMPT_REQUIRED',
      message: 'Prompt is required',
    };
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
    return {
      status: 400,
      code: 'QM_QUESTION_COUNT_INVALID',
      message: 'numQuestions must be a positive integer',
    };
  }

  const maxQuestions = qmMaxQuestions();
  if (resolvedNumQuestions > maxQuestions) {
    return {
      status: 400,
      code: 'QM_QUESTION_COUNT_TOO_LARGE',
      message: `numQuestions cannot exceed ${maxQuestions}`,
    };
  }

  return {
    prompt: prompt.trim(),
    numQuestions: resolvedNumQuestions,
    maxPromptChars,
    maxQuestions,
  };
}

export function generationBudgetError(validation) {
  const error = new Error(validation.message);
  error.status = validation.status;
  error.statusCode = validation.status;
  error.code = validation.code;
  error.isPublic = true;
  return error;
}
