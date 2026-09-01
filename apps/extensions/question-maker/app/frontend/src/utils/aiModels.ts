/**
 * Helpers for choosing AI models from the live Core/EduAI catalog.
 * Prefer campus (vllm/ollama) models; avoid hardcoding specific model ids.
 */
import type { EduAIModelOption } from "../services/eduaiService";
import { modelSizeRankFromText } from "./modelSizeRanks";

export const CAMPUS_PROVIDERS = new Set(["vllm", "ollama"]);

/** Soft last-resort ids when the catalog is empty (offline Core). */
export const FALLBACK_GENERATION_MODEL = "vllm:qwen3.5-9b-instruct";
export const FALLBACK_PROBE_MODEL = "vllm:qwen3.5-2b-instruct";
export const DEFAULT_GENERATION_MODEL_STORAGE_KEY = "qm:default-model";

export function isCampusModel(model: Pick<EduAIModelOption, "provider" | "id">): boolean {
  if (CAMPUS_PROVIDERS.has(model.provider)) return true;
  return model.id.startsWith("vllm:") || model.id.startsWith("ollama:");
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

/**
 * Honor the model selected in Settings when it is still present in the live
 * catalog. Otherwise retain the current valid choice before falling back to
 * the normal campus-first ranking.
 */
export function pickConfiguredGenerationModel(
  models: EduAIModelOption[],
  currentModel?: string,
): string {
  let configuredModel: string | null = null;
  try {
    configuredModel = localStorage.getItem(DEFAULT_GENERATION_MODEL_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }

  if (configuredModel && models.some((model) => model.id === configuredModel)) {
    return configuredModel;
  }
  if (currentModel && models.some((model) => model.id === currentModel)) {
    return currentModel;
  }
  return pickPreferredGenerationModel(models);
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
