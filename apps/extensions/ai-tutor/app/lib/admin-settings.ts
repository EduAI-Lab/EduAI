import { z } from "zod";

import api from "~/lib/api";
import { adminAiModelPolicySchema, type WireAdminAiModelPolicy } from "~/lib/api-schemas";
import type { EduAiApiKeyStatus } from "~/lib/types";

export type CostTier = "LOW" | "MEDIUM" | "HIGH";

export type AdminAiModelPolicy = {
  allowedTutorModelIds: string[];
  defaultTutorModelId: string | null;
  defaultSupervisorModelId: string | null;
  dualLoopEnabled: boolean;
  maxSupervisorIterations: number;
};

export type AdminAiModelOption = {
  id: string;
  modelId: string;
  modelName: string;
  provider?: string | null;
  summary?: string | null;
  costTier?: CostTier | null;
};

/**
 * The AI-policy payload as Core sends it, before `normalizePolicy` applies the
 * fallbacks. `api` decodes it at the wire boundary; this module only has to
 * decide what an absent or out-of-range field should fall back to.
 */
export type RawAdminAiModelPolicy = WireAdminAiModelPolicy;

export type AdminSettingsLoaderData = {
  status: EduAiApiKeyStatus;
  /** Unvalidated: consumers call `normalizePolicy` before reading fields. */
  aiPolicy: RawAdminAiModelPolicy | null;
  aiModels: AdminAiModelOption[];
  aiPolicyAvailable: boolean;
  aiPolicyError: string | null;
};

export const DEFAULT_POLICY: AdminAiModelPolicy = {
  allowedTutorModelIds: [],
  defaultTutorModelId: null,
  defaultSupervisorModelId: null,
  dualLoopEnabled: true,
  maxSupervisorIterations: 3,
};

const MIN_SUPERVISOR_ITERATIONS = 1;
const MAX_SUPERVISOR_ITERATIONS = 5;

export function getAdminSettingsApi() {
  return api;
}

export async function loadAdminSettingsData(): Promise<AdminSettingsLoaderData> {
  const hasPolicyApi = typeof api.getAdminAiModelPolicy === "function";
  const hasModelsApi = typeof api.listAiModels === "function";

  if (!hasPolicyApi && !hasModelsApi) {
    const status = await api.getEduAiApiKeyStatus();
    return {
      status,
      aiModels: [],
      aiPolicy: null,
      aiPolicyError: null,
      aiPolicyAvailable: false,
    };
  }

  const [status, aiModelsResult, aiPolicyResult] = await Promise.all([
    api.getEduAiApiKeyStatus(),
    loadAdminAiModels(),
    loadAdminAiPolicy(),
  ]);

  return {
    status,
    aiModels: aiModelsResult.models,
    aiPolicy: aiPolicyResult.policy,
    aiPolicyError: aiPolicyResult.error,
    aiPolicyAvailable: true,
  };
}

export function normalizePolicy(
  raw: RawAdminAiModelPolicy | null,
  models: AdminAiModelOption[],
): AdminAiModelPolicy {
  const policy = raw ?? adminAiModelPolicySchema.parse({});
  const fallbackTutor = models[0]?.modelId ?? null;

  const rawAllowed = Array.isArray(policy.allowedTutorModelIds)
    ? policy.allowedTutorModelIds.filter((id): id is string => typeof id === "string")
    : undefined;

  const allowedTutorModelIds =
    rawAllowed ?? (fallbackTutor === null ? [] : [fallbackTutor]);

  const requestedTutor = typeof policy.defaultTutorModelId === "string"
    ? policy.defaultTutorModelId
    : (allowedTutorModelIds[0] ?? null);
  const defaultTutorModelId =
    requestedTutor !== null && allowedTutorModelIds.includes(requestedTutor)
      ? requestedTutor
      : (allowedTutorModelIds[0] ?? null);

  const rawIterations = typeof policy.maxSupervisorIterations === "number"
    ? policy.maxSupervisorIterations
    : Number(policy.maxSupervisorIterations);

  return {
    allowedTutorModelIds,
    defaultTutorModelId,
    defaultSupervisorModelId: typeof policy.defaultSupervisorModelId === "string"
      ? policy.defaultSupervisorModelId
      : (models[0]?.modelId ?? null),
    dualLoopEnabled: typeof policy.dualLoopEnabled === "boolean"
      ? policy.dualLoopEnabled
      : DEFAULT_POLICY.dualLoopEnabled,
    maxSupervisorIterations:
      Number.isFinite(rawIterations)
        ? clampSupervisorIterations(rawIterations)
        : DEFAULT_POLICY.maxSupervisorIterations,
  };
}

function clampSupervisorIterations(value: number): number {
  return Math.max(MIN_SUPERVISOR_ITERATIONS, Math.min(MAX_SUPERVISOR_ITERATIONS, value));
}

async function loadAdminAiPolicy() {
  try {
    if (typeof api.getAdminAiModelPolicy !== "function") return { policy: null, error: null };
    const policy = await api.getAdminAiModelPolicy();
    return { policy, error: null };
  } catch {
    return {
      policy: null,
      error:
        "AI model settings could not be loaded. The rest of the admin tools are still available.",
    };
  }
}

async function loadAdminAiModels() {
  try {
    if (typeof api.listAiModels !== "function") return { models: [] };
    const rawModels = await api.listAiModels();
    const models = Array.isArray(rawModels)
      ? rawModels
          .filter((m): m is any => m != null && typeof m === "object" && typeof m.modelId === "string")
          .map((model, index) => toModelOption(model, index))
      : [];
    return { models };
  } catch {
    const models: AdminAiModelOption[] = [];
    return { models };
  }
}

/** One model entry as `api.listAiModels` decoded it, given its admin-facing defaults. */
function toModelOption(
  model: Awaited<ReturnType<typeof api.listAiModels>>[number],
  index: number,
): AdminAiModelOption {
  const modelName = model.modelName || model.modelId;
  return {
    id: model.id || `${model.modelId}-${index}`,
    modelId: model.modelId,
    modelName,
    provider: model.provider ?? inferProvider(model.modelId),
    summary: model.summary ?? null,
    costTier: model.costTier ?? inferCostTier(model.modelId, modelName),
  };
}

export function buildFallbackSummary(model: AdminAiModelOption) {
  const provider = model.provider ?? inferProvider(model.modelId);
  const costLabel = formatCostTier(model.costTier).toLowerCase();
  return `${model.modelName} is a ${provider} option suited for ${costLabel} usage with this admin policy.`;
}

export function inferProvider(modelId: string) {
  const [provider] = modelId.split(":");
  return provider || "provider";
}

export function inferCostTier(modelId: string, modelName: string): CostTier {
  const haystack = `${modelId} ${modelName}`.toLowerCase();
  if (haystack.includes("flash") || haystack.includes("mini") || haystack.includes("nano"))
    return "LOW";
  if (haystack.includes("pro") || haystack.includes("4.1") || haystack.includes("ultra"))
    return "HIGH";
  return "MEDIUM";
}

export type ApiKeySourceTag = { label: string };

export function formatCostTier(costTier: CostTier | null | undefined) {
  if (costTier === "LOW") return "Low cost";
  if (costTier === "HIGH") return "Higher cost";
  return "Balanced cost";
}

export function clampIterations(value: string) {
  const parsed = z.coerce.number().finite().safeParse(value);
  if (!parsed.success) return DEFAULT_POLICY.maxSupervisorIterations;
  return clampSupervisorIterations(Math.round(parsed.data));
}

export function formatApiKeyUpdatedTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

export function getApiKeySourceTag(status: EduAiApiKeyStatus): ApiKeySourceTag {
  if (!status.configured) return { label: "Not configured" };
  if (status.source === "ADMIN") return { label: "Admin override" };
  if (status.source === "ENV") return { label: "From .env" };
  return { label: "Configured" };
}
