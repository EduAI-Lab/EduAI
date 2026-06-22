import api from '~/lib/api';
import type { EduAiApiKeyStatus } from '~/lib/types';

export type CostTier = 'LOW' | 'MEDIUM' | 'HIGH';

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

export type AdminSettingsLoaderData = {
  status: EduAiApiKeyStatus;
  aiPolicy: AdminAiModelPolicy | null;
  aiModels: AdminAiModelOption[];
  aiPolicyAvailable: boolean;
  aiPolicyError: string | null;
};

type AdminSettingsApi = {
  getAdminAiModelPolicy?: () => Promise<unknown>;
  setAdminAiModelPolicy?: (payload: AdminAiModelPolicy) => Promise<unknown>;
  listAiModels?: () => Promise<unknown>;
};

export const DEFAULT_POLICY: AdminAiModelPolicy = {
  allowedTutorModelIds: [],
  defaultTutorModelId: null,
  defaultSupervisorModelId: null,
  dualLoopEnabled: true,
  maxSupervisorIterations: 3,
};

export function getAdminSettingsApi(): AdminSettingsApi {
  return api as typeof api & AdminSettingsApi;
}

export async function loadAdminSettingsData(): Promise<AdminSettingsLoaderData> {
  const settingsApi = getAdminSettingsApi();
  const aiPolicyAvailable =
    typeof settingsApi.getAdminAiModelPolicy === 'function' &&
    typeof settingsApi.setAdminAiModelPolicy === 'function';

  const [status, aiModelsResult, aiPolicyResult] = await Promise.all([
    api.getEduAiApiKeyStatus(),
    loadAdminAiModels(settingsApi),
    loadAdminAiPolicy(settingsApi),
  ]);

  return {
    status,
    aiModels: aiModelsResult.models,
    aiPolicy: aiPolicyResult.policy,
    aiPolicyError: aiPolicyResult.error,
    aiPolicyAvailable,
  };
}

export function normalizePolicy(
  raw: unknown,
  models: AdminAiModelOption[],
): AdminAiModelPolicy {
  const fallbackTutor = models[0]?.modelId ?? null;
  const allowedTutorModelIds = Array.isArray(
    (raw as { allowedTutorModelIds?: unknown })?.allowedTutorModelIds,
  )
    ? (raw as { allowedTutorModelIds: unknown[] }).allowedTutorModelIds.filter(
        (value): value is string => typeof value === 'string',
      )
    : fallbackTutor
      ? [fallbackTutor]
      : [];

  const defaultTutorModelId =
    typeof (raw as { defaultTutorModelId?: unknown })?.defaultTutorModelId === 'string'
      ? (raw as { defaultTutorModelId: string }).defaultTutorModelId
      : (allowedTutorModelIds[0] ?? null);

  return {
    allowedTutorModelIds,
    defaultTutorModelId:
      defaultTutorModelId && allowedTutorModelIds.includes(defaultTutorModelId)
        ? defaultTutorModelId
        : (allowedTutorModelIds[0] ?? null),
    defaultSupervisorModelId:
      typeof (raw as { defaultSupervisorModelId?: unknown })?.defaultSupervisorModelId === 'string'
        ? (raw as { defaultSupervisorModelId: string }).defaultSupervisorModelId
        : (models[0]?.modelId ?? null),
    dualLoopEnabled:
      typeof (raw as { dualLoopEnabled?: unknown })?.dualLoopEnabled === 'boolean'
        ? (raw as { dualLoopEnabled: boolean }).dualLoopEnabled
        : true,
    maxSupervisorIterations:
      typeof (raw as { maxSupervisorIterations?: unknown })?.maxSupervisorIterations === 'number'
        ? Math.max(
            1,
            Math.min(5, (raw as { maxSupervisorIterations: number }).maxSupervisorIterations),
          )
        : DEFAULT_POLICY.maxSupervisorIterations,
  };
}

async function loadAdminAiPolicy(settingsApi: AdminSettingsApi) {
  if (typeof settingsApi.getAdminAiModelPolicy !== 'function') {
    return { policy: null, error: null };
  }

  try {
    const policy = await settingsApi.getAdminAiModelPolicy();
    return { policy: policy as AdminAiModelPolicy, error: null };
  } catch {
    return {
      policy: null,
      error:
        'AI model settings could not be loaded. The rest of the admin tools are still available.',
    };
  }
}

async function loadAdminAiModels(settingsApi: AdminSettingsApi) {
  if (typeof settingsApi.listAiModels !== 'function') {
    return { models: [] as AdminAiModelOption[] };
  }

  try {
    const models = await settingsApi.listAiModels();
    const normalized = Array.isArray(models)
      ? models
          .map((model, index) => normalizeModelOption(model, index))
          .filter((model): model is AdminAiModelOption => model !== null)
      : [];

    return { models: normalized };
  } catch {
    return { models: [] as AdminAiModelOption[] };
  }
}

function normalizeModelOption(raw: unknown, index: number): AdminAiModelOption | null {
  if (!raw || typeof raw !== 'object') return null;

  const record = raw as Record<string, unknown>;
  const modelId =
    typeof record.modelId === 'string'
      ? record.modelId
      : typeof record.id === 'string'
        ? record.id
        : null;

  if (!modelId) {
    return null;
  }

  const provider = typeof record.provider === 'string' ? record.provider : inferProvider(modelId);
  const costTier =
    record.costTier === 'LOW' || record.costTier === 'MEDIUM' || record.costTier === 'HIGH'
      ? record.costTier
      : inferCostTier(modelId, String(record.modelName ?? modelId));

  return {
    id: typeof record.id === 'string' ? record.id : `${modelId}-${index}`,
    modelId,
    modelName:
      typeof record.modelName === 'string'
        ? record.modelName
        : typeof record.name === 'string'
          ? record.name
          : modelId,
    provider,
    summary: typeof record.summary === 'string' ? record.summary : null,
    costTier,
  };
}

export function buildFallbackSummary(model: AdminAiModelOption) {
  const provider = model.provider ?? inferProvider(model.modelId);
  const costLabel = formatCostTier(model.costTier).toLowerCase();
  return `${model.modelName} is a ${provider} option suited for ${costLabel} usage with this admin policy.`;
}

export function inferProvider(modelId: string) {
  const [provider] = modelId.split(':');
  return provider || 'provider';
}

export function inferCostTier(modelId: string, modelName: string): CostTier {
  const haystack = `${modelId} ${modelName}`.toLowerCase();
  if (haystack.includes('flash') || haystack.includes('mini') || haystack.includes('nano'))
    return 'LOW';
  if (haystack.includes('pro') || haystack.includes('4.1') || haystack.includes('ultra'))
    return 'HIGH';
  return 'MEDIUM';
}

export function formatCostTier(costTier: CostTier | null | undefined) {
  if (costTier === 'LOW') return 'Low cost';
  if (costTier === 'HIGH') return 'Higher cost';
  return 'Balanced cost';
}

export function costTierClassName(costTier: CostTier | null | undefined) {
  if (costTier === 'LOW') return 'tag tag-accent';
  if (costTier === 'HIGH') return 'tag tag-primary';
  return 'tag';
}

export function clampIterations(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_POLICY.maxSupervisorIterations;
  return Math.max(1, Math.min(5, Math.round(parsed)));
}

export function formatApiKeyUpdatedTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

export function getApiKeySourceTag(status: EduAiApiKeyStatus) {
  if (!status.configured) return { label: 'Not configured', className: 'tag' };
  if (status.source === 'ADMIN') return { label: 'Admin override', className: 'tag tag-primary' };
  if (status.source === 'ENV') return { label: 'From .env', className: 'tag tag-accent' };
  return { label: 'Configured', className: 'tag' };
}
