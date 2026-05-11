/**
 * @file Lists tutor-eligible AI models and validates user-supplied API keys.
 *
 * Responsibility: Provides the model picker its catalog (filtered by AI policy
 *   for students) and a way to confirm an API key works before the user wires
 *   it into a chat.
 * Callers: Mounted under `/api`; consumed by the model selector and the
 *   "bring-your-own-key" flow in the student/instructor activity UI.
 * Gotchas:
 *   - Model visibility is role-divergent: STUDENT sees only models the admin
 *     policy marks `allowedTutorModelIds`; instructors/admins see everything
 *     so they can preview disallowed models.
 *   - `/validate-key` always returns HTTP 200 with `{ valid: boolean, error? }`
 *     for any 4xx response from the upstream provider — only true network
 *     failures bubble out as 5xx. Consumers should branch on `valid`, NOT on
 *     status code.
 * Related: services/aiModelPolicy.js, routes/admin.js (policy editor)
 */

import express from 'express';
import { getAiModelPolicyState } from '../services/aiModelPolicy.js';

const router = express.Router();

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
router.get('/ai-models', async (req, res) => {
  try {
    const { policy, availableModels, availableModelsError } = await getAiModelPolicyState();

    if (availableModelsError) {
      return res
        .status(500)
        .json({ error: 'Failed to load AI models', detail: availableModelsError });
    }

    const visibleModels =
      req.user?.role === 'STUDENT'
        ? availableModels.filter((model) => policy.allowedTutorModelIds.includes(model.modelId))
        : availableModels;

    const models = visibleModels.map((model) => ({
      ...model,
      studentSelectable: policy.allowedTutorModelIds.includes(model.modelId),
      availability: policy.allowedTutorModelIds.includes(model.modelId) ? 'allowed' : 'admin-only',
    }));

    res.json(models);
  } catch (error) {
    console.error('Failed to load AI models:', error);
    res.status(500).json({ error: 'Failed to load AI models', detail: String(error) });
  }
});

/**
 * Validate an API key by making a minimal request to the provider.
 * Uses lightweight endpoints (list models) that don't consume tokens.
 *
 * Returns 200 with { valid: true/false, error? } so the client can read
 * provider-specific error messages. Only returns 4xx/5xx for actual request errors.
 */
router.post('/ai-models/validate-key', async (req, res) => {
  const { provider, apiKey } = req.body;

  if (!provider || !apiKey) {
    return res.status(400).json({ valid: false, error: 'Missing provider or apiKey' });
  }

  try {
    if (provider === 'google') {
      // Gemini: list models endpoint is free/lightweight
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(apiKey)}`,
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        const message = body?.error?.message || 'Invalid API key';
        return res.json({ valid: false, error: message });
      }
    } else if (provider === 'openai') {
      // OpenAI: GET /models is free
      const resp = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        const message = body?.error?.message || 'Invalid API key';
        return res.json({ valid: false, error: message });
      }
    } else {
      return res.json({ valid: false, error: `Unsupported provider: ${provider}` });
    }

    res.json({ valid: true });
  } catch (error) {
    console.error('API key validation failed:', error);
    res.status(500).json({ valid: false, error: 'Validation request failed' });
  }
});

export default router;
