/**
 * Helpers for choosing AI models from the live Core/EduAI catalog.
 * Prefer campus (vllm/ollama) models; avoid hardcoding specific model ids.
 */
import type { EduAIModelOption } from '../services/eduaiService';
import { modelSizeRankFromText } from '../../../shared/modelSizeRanks.js';

export const CAMPUS_PROVIDERS = new Set(['vllm', 'ollama']);

/** Soft last-resort ids when the catalog is empty (offline Core). */
export const FALLBACK_GENERATION_MODEL = 'vllm:qwen2.5-32b-instruct';
export const FALLBACK_PROBE_MODEL = 'vllm:qwen2.5-7b-instruct';

export function isCampusModel(model: Pick<EduAIModelOption, 'provider' | 'id'>): boolean {
  if (CAMPUS_PROVIDERS.has(model.provider)) return true;
  return model.id.startsWith('vllm:') || model.id.startsWith('ollama:');
}

function sizeRank(model: EduAIModelOption): number {
  return modelSizeRankFromText(`${model.id} ${model.label}`);
}

/** Preferred model for OCR / generation: largest campus model, else first catalog entry. */
export function pickPreferredGenerationModel(models: EduAIModelOption[]): string {
  if (!models.length) return FALLBACK_GENERATION_MODEL;
  const campus = models.filter(isCampusModel);
  const pool = campus.length > 0 ? campus : models;
  const ranked = [...pool].sort((a, b) => sizeRank(b) - sizeRank(a));
  return ranked[0]?.id ?? FALLBACK_GENERATION_MODEL;
}

/** Lightweight campus model for connectivity probes. */
export function pickCampusProbeModel(models: EduAIModelOption[]): EduAIModelOption | null {
  const campus = models.filter(isCampusModel);
  if (!campus.length) return null;
  const preferSmall = [...campus].sort((a, b) => {
    const aSize = sizeRank(a) || 999;
    const bSize = sizeRank(b) || 999;
    return aSize - bSize;
  });
  return preferSmall[0] ?? null;
}
