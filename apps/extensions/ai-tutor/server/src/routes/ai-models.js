/**
 * @file Lists tutor-eligible AI models and validates user-supplied API keys.
 *
 * Responsibility: Provides the model picker its catalog (filtered by AI policy
 *   for students) and a way to confirm an API key works before the user wires
 *   it into a chat.
 * Callers: Mounted under `/api`; consumed by the model selector and the
 *   "bring-your-own-key" flow in the student/instructor activity UI.
 * Gotchas:
 *   - Model visibility is role-divergent, gated by an allow-list of
 *     privileged roles (`PRIVILEGED_MODEL_ROLES`): those roles see every
 *     model so they can preview disallowed ones; everyone else (STUDENT, TA,
 *     or a missing/unrecognized `req.user.role`) is filtered down to the
 *     admin policy's `allowedTutorModelIds`. Deliberately an allow-list, not
 *     a `=== 'STUDENT'` deny-list, so an unrecognized role fails closed
 *     instead of leaking admin-only models.
 *   - `/validate-key` always returns HTTP 200 with `{ valid: boolean, error? }`
 *     for any 4xx response from the upstream provider — only true network
 *     failures bubble out as 5xx. Consumers should branch on `valid`, NOT on
 *     status code.
 *   - Key validation uses provider-specific lightweight probes. OpenCode's
 *     public models endpoint requires a bounded one-token chat probe so a key
 *     is actually exercised.
 * Related: services/aiModelPolicy.js, routes/admin.js (policy editor)
 */

import express from 'express';
import { AiProviderKeySchema } from '../../../shared/schemas/aiProviderKey.js';
import { getAiModelPolicyState } from '../services/aiModelPolicy.js';
import { validateProviderKey } from '../services/aiProviderKeyValidation.js';

const router = express.Router();
const DEFAULT_KEY_VALIDATION_TIMEOUT_MS = 5_000;
const KEY_VALIDATION_WINDOW_MS = 60_000;
const KEY_VALIDATION_ATTEMPTS_PER_WINDOW = 10;
const MAX_CONCURRENT_KEY_VALIDATIONS = 2;
const DEFAULT_MAX_TRACKED_VALIDATION_USERS = 10_000;
const keyValidationWindows = new Map();
const activeKeyValidations = new Map();

// Roles that may preview admin-only models. Everyone else (including a
// missing or unrecognized req.user.role) gets the allow-list-filtered view.
const PRIVILEGED_MODEL_ROLES = new Set(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]);

function getKeyValidationTimeoutMs() {
  const configured = Number(process.env.AI_KEY_VALIDATION_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_KEY_VALIDATION_TIMEOUT_MS;
  }
  return Math.min(Math.trunc(configured), 2_147_483_647);
}

function getMaxTrackedValidationUsers() {
  const configured = Number(process.env.AI_KEY_VALIDATION_MAX_TRACKED_USERS);
  if (!Number.isInteger(configured) || configured <= 0) {
    return DEFAULT_MAX_TRACKED_VALIDATION_USERS;
  }
  return configured;
}

function pruneExpiredValidationWindows(now) {
  for (const [userId, window] of keyValidationWindows) {
    if (now - window.startedAt >= KEY_VALIDATION_WINDOW_MS && !activeKeyValidations.has(userId)) {
      keyValidationWindows.delete(userId);
    }
  }
}

export function __resetKeyValidationStateForTests() {
  keyValidationWindows.clear();
  activeKeyValidations.clear();
}

function admitKeyValidation(req, res) {
  const userId = req.user?.id;
  // The application mounts this router behind requireAuth. Keeping the helper
  // permissive for a missing user also lets isolated route tests exercise
  // provider behavior without inventing an authentication layer.
  if (!userId) return () => {};

  const now = Date.now();
  const previousWindow = keyValidationWindows.get(userId);
  if (!previousWindow && keyValidationWindows.size >= getMaxTrackedValidationUsers()) {
    pruneExpiredValidationWindows(now);
    if (keyValidationWindows.size >= getMaxTrackedValidationUsers()) {
      res.status(503).json({ valid: false, error: 'Validation service busy' });
      return null;
    }
  }
  const currentWindow =
    previousWindow && now - previousWindow.startedAt < KEY_VALIDATION_WINDOW_MS
      ? previousWindow
      : { startedAt: now, attempts: 0 };

  if (currentWindow.attempts >= KEY_VALIDATION_ATTEMPTS_PER_WINDOW) {
    const retryAfter = Math.max(
      1,
      Math.ceil((KEY_VALIDATION_WINDOW_MS - (now - currentWindow.startedAt)) / 1000),
    );
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({ valid: false, error: 'Too many validation attempts' });
    return null;
  }

  const active = activeKeyValidations.get(userId) ?? 0;
  if (active >= MAX_CONCURRENT_KEY_VALIDATIONS) {
    res.set('Retry-After', '1');
    res.status(429).json({ valid: false, error: 'Too many validation attempts' });
    return null;
  }

  currentWindow.attempts += 1;
  keyValidationWindows.set(userId, currentWindow);
  activeKeyValidations.set(userId, active + 1);

  return () => {
    const remaining = (activeKeyValidations.get(userId) ?? 1) - 1;
    if (remaining <= 0) activeKeyValidations.delete(userId);
    else activeKeyValidations.set(userId, remaining);
  };
}

/**
 * GET /ai-models — list tutor-eligible models for the current user.
 *
 * Auth: any authenticated user.
 * Returns: array of models annotated with `studentSelectable` and
 *   `availability` ('allowed' | 'admin-only').
 *
 * Why: students never see the disallowed entries, so the picker can't even
 * tempt them; instructors see all models with `availability` so they can
 * understand what their students will actually see.
 */
router.get("/ai-models", async (req, res) => {
  try {
    const { policy, availableModels, availableModelsError } = await getAiModelPolicyState();

    const visibleModels = PRIVILEGED_MODEL_ROLES.has(req.user?.role)
      ? availableModels
      : availableModels.filter((model) => policy.allowedTutorModelIds.includes(model.modelId));

    const models = visibleModels.map((model) => ({
      ...model,
      studentSelectable: policy.allowedTutorModelIds.includes(model.modelId),
      availability: policy.allowedTutorModelIds.includes(model.modelId) ? "allowed" : "admin-only",
    }));

    res.json(models);
  } catch (error) {
    console.error('Failed to load AI models', { errorName: error?.name ?? 'UnknownError' });
    res.status(500).json({ error: 'Failed to load AI models' });
  }
});

/**
 * Validate an API key by making a provider-specific minimal request.
 * Most providers use a lightweight models endpoint; OpenCode uses a bounded
 * one-token chat probe because its models endpoint is public.
 *
 * Returns 200 with { valid: true/false, error? } so the client can read
 * provider-specific error messages. Only returns 4xx/5xx for actual request errors.
 */
router.post('/ai-models/validate-key', async (req, res) => {
  const parsedBody = AiProviderKeySchema.safeParse(req.body);
  if (!parsedBody.success) {
    const missingRequiredField = parsedBody.error.issues.some(
      (issue) =>
        (issue.code === 'invalid_type' && issue.received === 'undefined') ||
        (issue.code === 'too_small' && issue.minimum === 1),
    );
    return res.status(400).json({
      valid: false,
      error: missingRequiredField ? 'Missing provider or apiKey' : 'Invalid provider or apiKey',
    });
  }

  const { provider, apiKey } = parsedBody.data;
  if (provider !== 'google' && provider !== 'openai' && provider !== 'opencode') {
    return res.json({ valid: false, error: 'Unsupported provider' });
  }

  const releaseAdmission = admitKeyValidation(req, res);
  if (!releaseAdmission) return;

  const timeoutSignal = AbortSignal.timeout(getKeyValidationTimeoutMs());
  const signal = timeoutSignal;

  try {
    const validation = await validateProviderKey({ provider, apiKey, signal });
    return res.json(validation);
  } catch (error) {
    if (timeoutSignal.aborted) {
      return res.status(504).json({ valid: false, error: 'Validation request timed out' });
    }
    console.error('API key validation failed', {
      provider,
      errorName: error?.name ?? 'UnknownError',
    });
    res.status(500).json({ valid: false, error: 'Validation request failed' });
  } finally {
    releaseAdmission();
  }
});

export default router;
