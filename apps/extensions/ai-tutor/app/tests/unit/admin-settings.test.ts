import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_POLICY,
  buildFallbackSummary,
  clampIterations,
  formatApiKeyUpdatedTime,
  formatCostTier,
  getAdminSettingsApi,
  getApiKeySourceTag,
  inferCostTier,
  inferProvider,
  loadAdminSettingsData,
  normalizePolicy,
  type AdminAiModelOption,
} from '~/lib/admin-settings';

const {
  mockGetEduAiApiKeyStatus,
  mockGetAdminAiModelPolicy,
  mockSetAdminAiModelPolicy,
  mockListAiModels,
} = vi.hoisted(() => ({
  mockGetEduAiApiKeyStatus: vi.fn(),
  mockGetAdminAiModelPolicy: vi.fn(),
  mockSetAdminAiModelPolicy: vi.fn(),
  mockListAiModels: vi.fn(),
}));

vi.mock('~/lib/api', () => ({
  default: {
    getEduAiApiKeyStatus: mockGetEduAiApiKeyStatus,
    getAdminAiModelPolicy: mockGetAdminAiModelPolicy,
    setAdminAiModelPolicy: mockSetAdminAiModelPolicy,
    listAiModels: mockListAiModels,
  },
}));

describe('inferProvider', () => {
  it('reads the provider prefix from a namespaced model id', () => {
    expect(inferProvider('google:gemini-2.5-flash')).toBe('google');
    expect(inferProvider('openai:gpt-4.1')).toBe('openai');
  });

  it('falls back to a placeholder when there is no prefix', () => {
    expect(inferProvider('')).toBe('provider');
  });
});

describe('inferCostTier', () => {
  it('classifies flash/mini/nano models as low cost', () => {
    expect(inferCostTier('google:gemini-2.5-flash', 'Gemini Flash')).toBe('LOW');
    expect(inferCostTier('openai:gpt-4.1-mini', 'GPT mini')).toBe('LOW');
  });

  it('classifies pro/ultra/4.1 models as high cost', () => {
    // Note: "gemini" contains the substring "mini", so a gemini-*-pro model
    // still matches the LOW branch first — use a non-gemini id here.
    expect(inferCostTier('openai:gpt-4.1', 'GPT 4.1')).toBe('HIGH');
    expect(inferCostTier('anthropic:claude-ultra', 'Claude Ultra')).toBe('HIGH');
  });

  it('defaults to medium cost otherwise', () => {
    expect(inferCostTier('anthropic:claude', 'Claude')).toBe('MEDIUM');
  });
});

describe('formatCostTier', () => {
  it('formats known tiers', () => {
    expect(formatCostTier('LOW')).toBe('Low cost');
    expect(formatCostTier('HIGH')).toBe('Higher cost');
    expect(formatCostTier('MEDIUM')).toBe('Balanced cost');
  });

  it('formats missing tiers as balanced', () => {
    expect(formatCostTier(null)).toBe('Balanced cost');
    expect(formatCostTier(undefined)).toBe('Balanced cost');
  });
});

describe('clampIterations', () => {
  it('clamps within [1, 5] and rounds', () => {
    expect(clampIterations('3')).toBe(3);
    expect(clampIterations('0')).toBe(1);
    expect(clampIterations('10')).toBe(5);
    expect(clampIterations('2.6')).toBe(3);
  });

  it('falls back to the default for non-numeric input', () => {
    expect(clampIterations('abc')).toBe(DEFAULT_POLICY.maxSupervisorIterations);
  });
});

describe('formatApiKeyUpdatedTime', () => {
  it('returns null for null/invalid input', () => {
    expect(formatApiKeyUpdatedTime(null)).toBeNull();
    expect(formatApiKeyUpdatedTime('not-a-date')).toBeNull();
  });

  it('formats a valid ISO date', () => {
    const result = formatApiKeyUpdatedTime('2026-03-10T08:00:00.000Z');
    expect(typeof result).toBe('string');
    expect(result).not.toBeNull();
  });
});

describe('getApiKeySourceTag', () => {
  it('reports not configured when unset', () => {
    expect(
      getApiKeySourceTag({
        configured: false,
        source: 'NONE',
        hasAdminOverride: false,
        envConfigured: false,
        updatedAt: null,
      }),
    ).toEqual({ label: 'Not configured' });
  });

  it('reports admin override', () => {
    expect(
      getApiKeySourceTag({
        configured: true,
        source: 'ADMIN',
        hasAdminOverride: true,
        envConfigured: false,
        updatedAt: null,
      }),
    ).toEqual({ label: 'Admin override' });
  });

  it('reports from .env', () => {
    expect(
      getApiKeySourceTag({
        configured: true,
        source: 'ENV',
        hasAdminOverride: false,
        envConfigured: true,
        updatedAt: null,
      }),
    ).toEqual({ label: 'From .env' });
  });
});

describe('buildFallbackSummary', () => {
  it('builds a readable sentence from provider + cost tier', () => {
    const model: AdminAiModelOption = {
      id: '1',
      modelId: 'google:gemini-2.5-flash',
      modelName: 'Gemini Flash',
      provider: 'google',
      costTier: 'LOW',
    };
    expect(buildFallbackSummary(model)).toBe(
      'Gemini Flash is a google option suited for low cost usage with this admin policy.',
    );
  });

  it('infers the provider when missing and treats a missing cost tier as balanced', () => {
    // buildFallbackSummary reads `model.costTier` directly (it does not call
    // inferCostTier), so an omitted costTier falls back to "balanced cost".
    const model: AdminAiModelOption = {
      id: '2',
      modelId: 'openai:gpt-4.1',
      modelName: 'GPT 4.1',
    };
    expect(buildFallbackSummary(model)).toContain('openai');
    expect(buildFallbackSummary(model)).toContain('balanced cost');
  });
});

describe('normalizePolicy', () => {
  const models: AdminAiModelOption[] = [
    { id: '1', modelId: 'google:flash', modelName: 'Flash' },
    { id: '2', modelId: 'openai:gpt', modelName: 'GPT' },
  ];

  it('returns the default shape for a completely empty raw value', () => {
    const result = normalizePolicy({}, []);
    expect(result).toEqual({
      allowedTutorModelIds: [],
      defaultTutorModelId: null,
      defaultSupervisorModelId: null,
      dualLoopEnabled: true,
      maxSupervisorIterations: 3,
    });
  });

  it('falls back to the first model when no allowlist is given', () => {
    const result = normalizePolicy({}, models);
    expect(result.allowedTutorModelIds).toEqual(['google:flash']);
    expect(result.defaultTutorModelId).toBe('google:flash');
    expect(result.defaultSupervisorModelId).toBe('google:flash');
  });

  it('filters non-string entries from allowedTutorModelIds', () => {
    const result = normalizePolicy(
      { allowedTutorModelIds: ['google:flash', 42, null, 'openai:gpt'] },
      models,
    );
    expect(result.allowedTutorModelIds).toEqual(['google:flash', 'openai:gpt']);
  });

  it('resets defaultTutorModelId when it is not in the allowlist', () => {
    const result = normalizePolicy(
      { allowedTutorModelIds: ['openai:gpt'], defaultTutorModelId: 'google:flash' },
      models,
    );
    expect(result.defaultTutorModelId).toBe('openai:gpt');
  });

  it('preserves a valid defaultTutorModelId', () => {
    const result = normalizePolicy(
      { allowedTutorModelIds: ['google:flash', 'openai:gpt'], defaultTutorModelId: 'openai:gpt' },
      models,
    );
    expect(result.defaultTutorModelId).toBe('openai:gpt');
  });

  it('clamps maxSupervisorIterations from raw input', () => {
    expect(normalizePolicy({ maxSupervisorIterations: 20 }, models).maxSupervisorIterations).toBe(
      5,
    );
    expect(normalizePolicy({ maxSupervisorIterations: 0 }, models).maxSupervisorIterations).toBe(
      1,
    );
    expect(
      normalizePolicy({ maxSupervisorIterations: 'nope' }, models).maxSupervisorIterations,
    ).toBe(DEFAULT_POLICY.maxSupervisorIterations);
  });

  it('reads dualLoopEnabled when boolean, defaults true otherwise', () => {
    expect(normalizePolicy({ dualLoopEnabled: false }, models).dualLoopEnabled).toBe(false);
    expect(normalizePolicy({ dualLoopEnabled: 'false' }, models).dualLoopEnabled).toBe(true);
  });
});

describe('getAdminSettingsApi', () => {
  it('returns the api module', () => {
    expect(getAdminSettingsApi()).toBeDefined();
  });
});

describe('loadAdminSettingsData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads status, models, and policy together when the policy API is available', async () => {
    mockGetEduAiApiKeyStatus.mockResolvedValue({
      configured: true,
      source: 'ADMIN',
      hasAdminOverride: true,
      envConfigured: false,
      updatedAt: '2026-03-10T08:00:00.000Z',
    });
    mockListAiModels.mockResolvedValue([
      { id: '1', modelId: 'google:flash', modelName: 'Gemini Flash' },
    ]);
    mockGetAdminAiModelPolicy.mockResolvedValue({
      allowedTutorModelIds: ['google:flash'],
      defaultTutorModelId: 'google:flash',
      defaultSupervisorModelId: 'google:flash',
      dualLoopEnabled: true,
      maxSupervisorIterations: 3,
    });

    const data = await loadAdminSettingsData();

    expect(data.aiPolicyAvailable).toBe(true);
    expect(data.aiModels).toHaveLength(1);
    expect(data.aiModels[0].modelId).toBe('google:flash');
    expect(data.aiPolicy?.defaultTutorModelId).toBe('google:flash');
    expect(data.aiPolicyError).toBeNull();
  });

  it('surfaces a policy load error without failing the whole load', async () => {
    mockGetEduAiApiKeyStatus.mockResolvedValue({
      configured: false,
      source: 'NONE',
      hasAdminOverride: false,
      envConfigured: false,
      updatedAt: null,
    });
    mockListAiModels.mockResolvedValue([]);
    mockGetAdminAiModelPolicy.mockRejectedValue(new Error('boom'));

    const data = await loadAdminSettingsData();

    expect(data.aiPolicy).toBeNull();
    expect(data.aiPolicyError).toMatch(/could not be loaded/i);
    expect(data.aiModels).toEqual([]);
  });

  it('normalizes model list entries and drops invalid ones', async () => {
    mockGetEduAiApiKeyStatus.mockResolvedValue({
      configured: false,
      source: 'NONE',
      hasAdminOverride: false,
      envConfigured: false,
      updatedAt: null,
    });
    mockListAiModels.mockResolvedValue([
      { id: 'a', modelId: 'openai:gpt-4.1-mini', modelName: 'Mini' },
      { notAModel: true },
      'garbage',
    ]);
    mockGetAdminAiModelPolicy.mockResolvedValue(null);

    const data = await loadAdminSettingsData();

    expect(data.aiModels).toHaveLength(1);
    expect(data.aiModels[0].costTier).toBe('LOW');
  });

  it('reports aiPolicyAvailable=false and empty models when those APIs are missing', async () => {
    mockGetEduAiApiKeyStatus.mockResolvedValue({
      configured: false,
      source: 'NONE',
      hasAdminOverride: false,
      envConfigured: false,
      updatedAt: null,
    });

    // Simulate an api module lacking the optional admin methods.
    const apiModule = await import('~/lib/api');
    const originalListAiModels = apiModule.default.listAiModels;
    const originalGetPolicy = apiModule.default.getAdminAiModelPolicy;
    const originalSetPolicy = apiModule.default.setAdminAiModelPolicy;
    // @ts-expect-error -- intentionally deleting optional methods for the test
    delete apiModule.default.listAiModels;
    // @ts-expect-error
    delete apiModule.default.getAdminAiModelPolicy;
    // @ts-expect-error
    delete apiModule.default.setAdminAiModelPolicy;

    try {
      const data = await loadAdminSettingsData();
      expect(data.aiPolicyAvailable).toBe(false);
      expect(data.aiModels).toEqual([]);
      expect(data.aiPolicy).toBeNull();
      expect(data.aiPolicyError).toBeNull();
    } finally {
      apiModule.default.listAiModels = originalListAiModels;
      apiModule.default.getAdminAiModelPolicy = originalGetPolicy;
      apiModule.default.setAdminAiModelPolicy = originalSetPolicy;
    }
  });
});
