import type { OllamaModel, VllmModel } from "~/components/admin/model-form-dialog";
import type { AIModel } from "~/hooks/api/types";

/**
 * The registration body a discovered local model is created with. Every field
 * is filled in by the builders below, so this is the whole contract the caller
 * hands to `POST /api/ai-models` — not an open bag it has to inspect.
 */
export type LocalModelCreatePayload = {
  modelId: string;
  name: string;
  description: string;
  type: "CHAT";
  supportsImages: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  inputPricing: number;
  outputPricing: number;
  isActive: boolean;
  // Sync discovers and registers a model; it does not guess which Auto
  // routing tier (if any) that model should occupy — that is an admin
  // decision made afterward in the model edit dialog. Explicitly `null`
  // rather than omitted so a newly-synced model is never silently missing
  // this field from its create payload.
  routerTier: null;
};

/** A discovered model's fields plus the provider it was discovered under. */
export type LocalModelCreateRequest = LocalModelCreatePayload & { providerId: string };

export type LocalModelSyncResult = {
  created: number;
  skipped: number;
  failed: number;
  createdNames: string[];
};

/** Capabilities for campus vLLM models not described by `/v1/models`. */
export type LocalModelCapabilities = {
  supportsImages: boolean;
  supportsTools: boolean;
};

export function vllmModelCapabilities(modelId: string): LocalModelCapabilities {
  const qwen38 = modelId.trim().toLowerCase() === "qwen3.8-27b-instruct";
  return { supportsImages: qwen38, supportsTools: qwen38 };
}

export function buildOllamaModelCreatePayload(ollama: OllamaModel): LocalModelCreatePayload {
  const modelId = ollama.name;
  const lower = modelId.toLowerCase();

  return {
    modelId,
    name: modelId.charAt(0).toUpperCase() + modelId.slice(1),
    description: `Local Ollama model: ${modelId}`,
    type: "CHAT",
    supportsImages: lower.includes("vision") || lower.includes("llava"),
    supportsTools: true,
    supportsStreaming: true,
    inputPricing: 0,
    outputPricing: 0,
    isActive: true,
    routerTier: null,
  };
}

export function buildVllmModelCreatePayload(vllm: VllmModel): LocalModelCreatePayload {
  const capabilities = vllmModelCapabilities(vllm.id);
  const displayName = vllm.id
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return {
    modelId: vllm.id,
    name: displayName,
    description: `Local vLLM model: ${vllm.id}`,
    type: "CHAT",
    supportsImages: capabilities.supportsImages,
    supportsTools: capabilities.supportsTools,
    supportsStreaming: true,
    inputPricing: 0,
    outputPricing: 0,
    isActive: true,
    routerTier: null,
  };
}

export function formatLocalModelSyncMessage(
  providerLabel: string,
  result: LocalModelSyncResult,
): string {
  if (result.created === 0 && result.failed === 0) {
    return `${providerLabel}: all ${result.skipped} discovered model(s) were already registered.`;
  }

  const parts = [`${providerLabel}: added ${result.created} model(s)`];
  if (result.skipped > 0) parts.push(`${result.skipped} already registered`);
  if (result.failed > 0) parts.push(`${result.failed} failed`);
  return `${parts.join(", ")}.`;
}

export async function syncLocalModels(
  existingModels: AIModel[],
  providerId: string,
  payloads: LocalModelCreatePayload[],
  onCreateModel: (data: LocalModelCreateRequest) => Promise<void>,
): Promise<LocalModelSyncResult> {
  const existingIds = new Set(
    existingModels.filter((model) => model.providerId === providerId).map((model) => model.modelId),
  );

  const result: LocalModelSyncResult = {
    created: 0,
    skipped: 0,
    failed: 0,
    createdNames: [],
  };

  for (const payload of payloads) {
    const modelId = String(payload.modelId ?? "");
    if (!modelId || existingIds.has(modelId)) {
      result.skipped++;
      continue;
    }

    try {
      await onCreateModel({ ...payload, providerId });
      result.created++;
      result.createdNames.push(String(payload.name ?? modelId));
      existingIds.add(modelId);
    } catch {
      result.failed++;
    }
  }

  return result;
}
