/**
 * @file Admin-controlled policy governing which AI models the tutor may use
 *   and how aggressively the supervisor loop runs.
 *
 * Responsibility: Read/write the `AI_MODEL_POLICY` SystemSetting (a JSON
 *   blob), reconcile it against the live EduAI model catalog, and expose
 *   resolution helpers used by request-time code (`resolveTutorModelSelection`,
 *   `resolveSupervisorSettings`).
 * Callers: Admin UI routes (`routes/ai-models.js`, `routes/admin.js`) for
 *   read/write, and `aiGuidance.js` consumers (e.g. `routes/activities.js`)
 *   for per-request resolution.
 * Gotchas:
 *   - Policy is a single JSON document under SystemSetting key
 *     `AI_MODEL_POLICY`. Schema migrations require updating
 *     `normalizeStoredAiModelPolicy` to keep older blobs forward-compatible.
 *   - Cost-tier inference is heuristic substring-matching against model name
 *     and id (see `inferCostTier`). New providers/families need entries here
 *     or they'll silently bucket as MEDIUM.
 *   - `resolveTutorModelSelection` throws a 403 (status attached) when a
 *     student requests a model that isn't on the allow-list — routes are
 *     expected to map `error.status` straight to the HTTP response.
 *   - Supervisor iteration count is clamped to [1, 5]; 5 is a hard guardrail
 *     against runaway dual-loop costs.
 *   - Defaults if the setting is unset or unparseable: empty allow-list (which
 *     `resolveAiModelPolicy` then expands to the entire live catalog),
 *     `defaultTutorModelId` falls back to `google:gemini-2.5-flash` (or first
 *     catalog entry), `dualLoopEnabled` defaults to true,
 *     `maxSupervisorIterations` defaults to 3.
 * Related: `aiGuidance.js`, `eduaiClient.js`, `systemSettings.js`.
 */

import { listEduAiModels } from './eduaiClient.js';
import { SYSTEM_SETTING_KEYS, getSystemSetting, setSystemSetting } from './systemSettings.js';

export const DEFAULT_TUTOR_MODEL = 'google:gemini-2.5-flash';
export const DEFAULT_MAX_SUPERVISOR_ITERATIONS = 3;
// Hard floor/ceiling for supervisor iterations: 0 would disable supervision
// (use dualLoopEnabled instead), >5 risks runaway cost on a per-request basis.
const MIN_SUPERVISOR_ITERATIONS = 1;
const MAX_SUPERVISOR_ITERATIONS = 5;

function getPreferredDefaultModelId(modelIds) {
  if (modelIds.includes(DEFAULT_TUTOR_MODEL)) return DEFAULT_TUTOR_MODEL;
  return modelIds[0] ?? null;
}

/**
 * Heuristic cost-tier classification from model name/id.
 *
 * Substring rationale (informed by current pricing pages, not enforced
 * elsewhere in code):
 *   - LOW: `flash` (Gemini Flash), `mini` (GPT-4o-mini, o3-mini), `haiku`
 *     (Claude Haiku) — small/distilled families.
 *   - HIGH: `pro` (Gemini Pro), `opus` (Claude Opus), `o1`/`reasoning`
 *     (OpenAI reasoning models) — flagship/reasoning tiers.
 *   - MEDIUM: everything else (e.g. Sonnet, default GPT-4o).
 *
 * When new model families launch, add a substring here so the admin UI can
 * surface accurate cost guidance.
 */
function inferCostTier(modelId = '', modelName = '') {
  const normalized = `${modelId} ${modelName}`.toLowerCase();
  if (/(flash|mini|haiku)/.test(normalized)) return 'LOW';
  if (/(pro|opus|o1|reasoning)/.test(normalized)) return 'HIGH';
  return 'MEDIUM';
}

function inferSummary(modelId = '', modelName = '') {
  const normalized = `${modelId} ${modelName}`.toLowerCase();
  if (/(flash|mini|haiku)/.test(normalized)) {
    return 'Fast response with lower cost; good for everyday guidance and short feedback loops.';
  }
  if (/(pro|opus|o1|reasoning)/.test(normalized)) {
    return 'Higher quality reasoning with higher cost; best when you want stricter review or more nuanced tutoring.';
  }
  return 'Balanced model that trades cost and quality evenly for general tutoring tasks.';
}

/**
 * Coerce arbitrary input to an integer in [MIN, MAX]; non-numeric falls back
 * to the default. Used both at write-time (admin save) and read-time
 * (defensive against tampered/legacy stored values).
 */
export function clampSupervisorIterations(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_MAX_SUPERVISOR_ITERATIONS;
  return Math.max(
    MIN_SUPERVISOR_ITERATIONS,
    Math.min(MAX_SUPERVISOR_ITERATIONS, Math.trunc(numeric)),
  );
}

/**
 * Shape-fix a policy blob read from storage (or supplied by an admin form).
 * Drops invalid entries instead of throwing — older blobs and partial inputs
 * should still produce a usable policy with sensible defaults.
 * Note: `dualLoopEnabled` is `!== false` so a missing field defaults to true.
 */
export function normalizeStoredAiModelPolicy(rawPolicy = {}) {
  return {
    allowedTutorModelIds: Array.isArray(rawPolicy.allowedTutorModelIds)
      ? Array.from(
          new Set(
            rawPolicy.allowedTutorModelIds.filter(
              (value) => typeof value === 'string' && value.trim(),
            ),
          ),
        )
      : [],
    defaultTutorModelId:
      typeof rawPolicy.defaultTutorModelId === 'string' && rawPolicy.defaultTutorModelId.trim()
        ? rawPolicy.defaultTutorModelId.trim()
        : null,
    defaultSupervisorModelId:
      typeof rawPolicy.defaultSupervisorModelId === 'string' &&
      rawPolicy.defaultSupervisorModelId.trim()
        ? rawPolicy.defaultSupervisorModelId.trim()
        : null,
    dualLoopEnabled: rawPolicy.dualLoopEnabled !== false,
    maxSupervisorIterations: clampSupervisorIterations(rawPolicy.maxSupervisorIterations),
  };
}

/**
 * Reconcile a stored policy against the live model catalog.
 *
 * Why: stored policy may reference models EduAI no longer offers (or vice
 * versa); we need to drop stale ids, fall back when defaults disappear, and
 * handle the special case of an empty allow-list (means "allow everything
 * currently available"). When the catalog is unavailable (empty array passed),
 * we trust the stored values rather than wiping them out.
 */
export function resolveAiModelPolicy(rawPolicy = {}, availableModelIds = []) {
  const normalized = normalizeStoredAiModelPolicy(rawPolicy);
  const normalizedModelIds = Array.from(new Set(availableModelIds.filter(Boolean)));

  const allowedTutorModelIds =
    normalized.allowedTutorModelIds.length > 0
      ? normalized.allowedTutorModelIds.filter(
          (modelId) => normalizedModelIds.length === 0 || normalizedModelIds.includes(modelId),
        )
      : normalizedModelIds;

  const fallbackTutorModelId = getPreferredDefaultModelId(allowedTutorModelIds);
  const defaultTutorModelId =
    normalized.defaultTutorModelId &&
    (normalizedModelIds.length === 0 ||
      allowedTutorModelIds.includes(normalized.defaultTutorModelId))
      ? normalized.defaultTutorModelId
      : fallbackTutorModelId;

  const fallbackSupervisorModelId =
    defaultTutorModelId ?? getPreferredDefaultModelId(normalizedModelIds);
  const defaultSupervisorModelId =
    normalized.defaultSupervisorModelId &&
    (normalizedModelIds.length === 0 ||
      normalizedModelIds.includes(normalized.defaultSupervisorModelId))
      ? normalized.defaultSupervisorModelId
      : fallbackSupervisorModelId;

  return {
    allowedTutorModelIds,
    defaultTutorModelId,
    defaultSupervisorModelId,
    dualLoopEnabled: normalized.dualLoopEnabled,
    maxSupervisorIterations: normalized.maxSupervisorIterations,
  };
}

function mapCatalogModel(model) {
  const modelId = `${model.provider.name}:${model.modelId}`;
  const costTier = inferCostTier(modelId, model.name);
  return {
    id: model.id,
    modelId,
    modelName: model.name,
    provider: model.provider.name,
    costTier,
    summary: inferSummary(modelId, model.name),
    roleHint:
      costTier === 'HIGH'
        ? 'Stronger supervisor candidate when you want stricter review quality.'
        : 'Good tutor candidate when you want a responsive student-facing experience.',
  };
}

/**
 * Pull the upstream EduAI model list, drop disabled ones, and tag each with
 * derived UI hints (cost tier, summary, role recommendation). Sorted by
 * display name so the admin UI is stable across reloads.
 */
export async function loadAiModelCatalog() {
  const eduAiModels = await listEduAiModels();
  return eduAiModels
    .filter((model) => model.isActive)
    .map(mapCatalogModel)
    .toSorted((a, b) => a.modelName.localeCompare(b.modelName));
}

/**
 * Load the persisted policy blob and normalize. Returns the default-shaped
 * policy on missing or unparseable rows so callers never need null checks —
 * this is the entry point for request-time resolution helpers below.
 */
export async function getStoredAiModelPolicy() {
  const stored = await getSystemSetting(SYSTEM_SETTING_KEYS.AI_MODEL_POLICY);
  if (!stored?.value) return normalizeStoredAiModelPolicy();

  try {
    return normalizeStoredAiModelPolicy(JSON.parse(stored.value));
  } catch (error) {
    console.error('Failed to parse stored AI model policy:', error);
    return normalizeStoredAiModelPolicy();
  }
}

/**
 * Admin UI snapshot: stored policy + per-model annotations + catalog-load
 * error string (when the EduAI catalog fetch fails). Catalog failures are
 * non-fatal so the admin can still see and edit the stored policy.
 */
export async function getAiModelPolicyState() {
  const storedPolicy = await getStoredAiModelPolicy();

  try {
    const availableModels = await loadAiModelCatalog();
    const policy = resolveAiModelPolicy(
      storedPolicy,
      availableModels.map((model) => model.modelId),
    );

    return {
      policy,
      availableModels: availableModels.map((model) => ({
        ...model,
        isAllowedForTutor: policy.allowedTutorModelIds.includes(model.modelId),
        isDefaultTutor: policy.defaultTutorModelId === model.modelId,
        isDefaultSupervisor: policy.defaultSupervisorModelId === model.modelId,
      })),
      availableModelsError: null,
    };
  } catch (error) {
    console.error('Failed to load AI model catalog:', error);
    return {
      policy: resolveAiModelPolicy(storedPolicy, []),
      availableModels: [],
      availableModelsError: String(error),
    };
  }
}

/**
 * Persist a new policy after validating against the live catalog. Throws
 * (plain Error, no status) on contract violations: empty allow-list, default
 * tutor not in allow-list, or supervisor model not in catalog. Caller maps
 * these to 400-level responses.
 */
export async function setAiModelPolicy(policyInput) {
  const availableModels = await loadAiModelCatalog();
  const availableModelIds = availableModels.map((model) => model.modelId);
  const nextPolicy = resolveAiModelPolicy(policyInput, availableModelIds);

  if (nextPolicy.allowedTutorModelIds.length === 0) {
    throw new Error('At least one tutor model must be allowed');
  }

  if (
    !nextPolicy.defaultTutorModelId ||
    !nextPolicy.allowedTutorModelIds.includes(nextPolicy.defaultTutorModelId)
  ) {
    throw new Error('defaultTutorModelId must be one of the allowed tutor models');
  }

  if (
    !nextPolicy.defaultSupervisorModelId ||
    !availableModelIds.includes(nextPolicy.defaultSupervisorModelId)
  ) {
    throw new Error('defaultSupervisorModelId must reference an available model');
  }

  await setSystemSetting(SYSTEM_SETTING_KEYS.AI_MODEL_POLICY, JSON.stringify(nextPolicy));
  return getAiModelPolicyState();
}

/**
 * Per-request gate: validate a student's requested tutor model against the
 * stored allow-list. Returns the requested id if allowed, or the policy
 * default if none was requested. Throws Error w/ `status=403` when the
 * requested model is on the catalog but blocked by policy — routes propagate
 * `error.status` directly to the response.
 */
export async function resolveTutorModelSelection(requestedModelId) {
  const storedPolicy = await getStoredAiModelPolicy();
  const allowedTutorModelIds = storedPolicy.allowedTutorModelIds;

  if (
    requestedModelId &&
    allowedTutorModelIds.length > 0 &&
    !allowedTutorModelIds.includes(requestedModelId)
  ) {
    const error = new Error('Selected tutor model is not allowed');
    error.status = 403;
    throw error;
  }

  return requestedModelId || storedPolicy.defaultTutorModelId || DEFAULT_TUTOR_MODEL;
}

/**
 * Per-request supervisor configuration. The fallback chain
 * (supervisor → tutor default → DEFAULT_TUTOR_MODEL) ensures we always have
 * *some* supervisor model id, even if the admin only configured a tutor.
 */
export async function resolveSupervisorSettings() {
  const storedPolicy = await getStoredAiModelPolicy();
  return {
    dualLoopEnabled: storedPolicy.dualLoopEnabled,
    maxSupervisorIterations: storedPolicy.maxSupervisorIterations,
    supervisorModelId:
      storedPolicy.defaultSupervisorModelId ||
      storedPolicy.defaultTutorModelId ||
      DEFAULT_TUTOR_MODEL,
  };
}
