import type { OllamaModel, VllmModel } from "~/components/admin/model-form-dialog";
import type { AIModel } from "~/hooks/api/types";

export type LocalModelSyncResult = {
  created: number;
  skipped: number;
  failed: number;
  createdNames: string[];
};

export function buildOllamaModelCreatePayload(ollama: OllamaModel): Record<string, unknown> {
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
  };
}

export function buildVllmModelCreatePayload(vllm: VllmModel): Record<string, unknown> {
  const displayName = vllm.id
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return {
    modelId: vllm.id,
    name: displayName,
    description: `Local vLLM model: ${vllm.id}`,
    type: "CHAT",
    supportsImages: false,
    supportsTools: false,
    supportsStreaming: true,
    inputPricing: 0,
    outputPricing: 0,
    isActive: true,
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
  payloads: Record<string, unknown>[],
  onCreateModel: (data: Record<string, unknown>) => Promise<void>,
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
