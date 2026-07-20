/**
 * Resolve campus vs cloud models from Core's /api/ai-models payload.
 * Avoid hardcoding served-model names so GPU catalog changes don't break QM.
 */
import { modelSizeRankFromText } from '../../../shared/modelSizeRanks.js';

const CAMPUS_PROVIDERS = new Set(['vllm', 'ollama']);
export const FALLBACK_PROBE_MODEL = 'vllm:qwen2.5-7b-instruct';
export const FALLBACK_GENERATION_MODEL = 'vllm:qwen2.5-32b-instruct';

function providerName(raw) {
  if (!raw) return 'unknown';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && raw.name) return String(raw.name);
  return String(raw);
}

function normalizeModels(rawModels) {
  if (!Array.isArray(rawModels)) return [];
  return rawModels
    .filter((m) => m && m.isActive !== false)
    .map((m) => {
      const provider = providerName(m.provider);
      const modelId = m.modelId || m.id || '';
      return {
        id: `${provider}:${modelId}`,
        modelId: String(modelId),
        label: m.name || modelId,
        provider,
      };
    })
    .filter((m) => m.modelId);
}

function sizeRank(model) {
  return modelSizeRankFromText(`${model.id} ${model.label}`);
}

export function isCampusModel(model) {
  return CAMPUS_PROVIDERS.has(model.provider);
}

/** Smallest campus model for connectivity probes. */
export function pickCampusProbeFromCatalog(rawModels) {
  const models = normalizeModels(rawModels).filter(isCampusModel);
  if (!models.length) return null;
  const ranked = [...models].sort((a, b) => {
    const aSize = sizeRank(a) || 999;
    const bSize = sizeRank(b) || 999;
    return aSize - bSize;
  });
  return ranked[0] ?? null;
}

/** Largest campus model for generation/extraction defaults. */
export function pickPreferredGenerationFromCatalog(rawModels) {
  const models = normalizeModels(rawModels);
  if (!models.length) return null;
  const campus = models.filter(isCampusModel);
  const pool = campus.length ? campus : models;
  const ranked = [...pool].sort((a, b) => sizeRank(b) - sizeRank(a));
  return ranked[0] ?? null;
}

export function campusProbeParams(rawModels) {
  const picked = pickCampusProbeFromCatalog(rawModels);
  if (!picked) {
    return {
      provider: 'vllm',
      model: FALLBACK_PROBE_MODEL,
      apiKeys: { vllm: { isEnabled: true } },
    };
  }
  return {
    provider: picked.provider,
    model: picked.id,
    apiKeys: { [picked.provider]: { isEnabled: true } },
  };
}
