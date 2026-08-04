/**
 * Unit tests for the async layer of aiModelPolicy.js — catalog loading,
 * stored-policy read/write, and per-request resolution helpers.
 *
 * The pure functions (clampSupervisorIterations, normalizeStoredAiModelPolicy,
 * resolveAiModelPolicy) already have thorough coverage in aiModelPolicy.test.js;
 * this file intentionally does not duplicate those.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockListEduAiModels = vi.fn();
const mockGetSystemSetting = vi.fn();
const mockSetSystemSetting = vi.fn();

vi.mock('../../src/services/eduaiClient.js', () => ({
  listEduAiModels: (...args) => mockListEduAiModels(...args),
}));

vi.mock('../../src/services/systemSettings.js', () => ({
  SYSTEM_SETTING_KEYS: { AI_MODEL_POLICY: 'AI_MODEL_POLICY' },
  getSystemSetting: (...args) => mockGetSystemSetting(...args),
  setSystemSetting: (...args) => mockSetSystemSetting(...args),
}));

const {
  loadAiModelCatalog,
  getStoredAiModelPolicy,
  getAiModelPolicyState,
  setAiModelPolicy,
  resolveTutorModelSelection,
  resolveSupervisorSettings,
  DEFAULT_TUTOR_MODEL,
} = await import('../../src/services/aiModelPolicy.js');

beforeEach(() => {
  mockListEduAiModels.mockReset();
  mockGetSystemSetting.mockReset();
  mockSetSystemSetting.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function catalogModel({ id, modelId, name, provider, isActive = true }) {
  return { id, modelId, name, isActive, provider: { name: provider } };
}

describe('loadAiModelCatalog', () => {
  it('drops inactive models, maps fields, and sorts by name', async () => {
    mockListEduAiModels.mockResolvedValue([
      catalogModel({ id: '1', modelId: 'gemini-2.5-pro', name: 'Gemini Pro', provider: 'google' }),
      catalogModel({ id: '2', modelId: 'gpt-4o-mini', name: 'GPT-4o mini', provider: 'openai' }),
      catalogModel({ id: '3', modelId: 'old', name: 'Old Model', provider: 'openai', isActive: false }),
    ]);

    const catalog = await loadAiModelCatalog();

    // localeCompare orders "Gemini Pro" before "GPT-4o mini" ('e' < 'p').
    expect(catalog.map((m) => m.modelName)).toEqual(['Gemini Pro', 'GPT-4o mini']);
    expect(catalog.every((m) => m.id !== '3')).toBe(true);
    expect(catalog[0].modelId).toBe('google:gemini-2.5-pro');
  });

  it('infers LOW cost tier for flash/mini/haiku models', async () => {
    mockListEduAiModels.mockResolvedValue([
      catalogModel({ id: '1', modelId: 'gemini-2.5-flash', name: 'Gemini Flash', provider: 'google' }),
      catalogModel({ id: '2', modelId: 'gpt-4o-mini', name: 'GPT-4o mini', provider: 'openai' }),
      catalogModel({ id: '3', modelId: 'claude-haiku', name: 'Claude Haiku', provider: 'anthropic' }),
    ]);

    const catalog = await loadAiModelCatalog();

    expect(catalog.every((m) => m.costTier === 'LOW')).toBe(true);
  });

  it('infers HIGH cost tier for pro/opus/o1/reasoning models', async () => {
    mockListEduAiModels.mockResolvedValue([
      // Note: "gemini" itself contains "mini" (ge-MINI-pro), which the LOW
      // heuristic matches first — use a non-Gemini "pro" model to isolate
      // the HIGH-tier "pro" substring check from that overlap.
      catalogModel({ id: '1', modelId: 'ultra-pro', name: 'Ultra Pro', provider: 'acme' }),
      catalogModel({ id: '2', modelId: 'claude-opus', name: 'Claude Opus', provider: 'anthropic' }),
      catalogModel({ id: '3', modelId: 'o1', name: 'o1', provider: 'openai' }),
      catalogModel({ id: '4', modelId: 'x-reasoning', name: 'Reasoning Model', provider: 'openai' }),
    ]);

    const catalog = await loadAiModelCatalog();

    expect(catalog.every((m) => m.costTier === 'HIGH')).toBe(true);
    catalog.forEach((m) => {
      expect(m.roleHint).toMatch(/supervisor/i);
    });
  });

  it('defaults to MEDIUM cost tier for everything else', async () => {
    mockListEduAiModels.mockResolvedValue([
      catalogModel({ id: '1', modelId: 'gpt-4o', name: 'GPT-4o', provider: 'openai' }),
    ]);

    const catalog = await loadAiModelCatalog();

    expect(catalog[0].costTier).toBe('MEDIUM');
    expect(catalog[0].roleHint).toMatch(/tutor candidate/i);
  });
});

describe('getStoredAiModelPolicy', () => {
  it('returns normalized defaults when no setting is stored', async () => {
    mockGetSystemSetting.mockResolvedValue(null);

    const policy = await getStoredAiModelPolicy();

    expect(policy.allowedTutorModelIds).toEqual([]);
    expect(policy.dualLoopEnabled).toBe(true);
  });

  it('parses and normalizes a stored JSON policy blob', async () => {
    mockGetSystemSetting.mockResolvedValue({
      value: JSON.stringify({ allowedTutorModelIds: ['a', 'b'], dualLoopEnabled: false }),
    });

    const policy = await getStoredAiModelPolicy();

    expect(policy.allowedTutorModelIds).toEqual(['a', 'b']);
    expect(policy.dualLoopEnabled).toBe(false);
  });

  it('returns normalized defaults when the stored value is unparseable JSON', async () => {
    mockGetSystemSetting.mockResolvedValue({ value: '{not json' });

    const policy = await getStoredAiModelPolicy();

    expect(policy.allowedTutorModelIds).toEqual([]);
    expect(policy.defaultTutorModelId).toBeNull();
  });
});

describe('getAiModelPolicyState', () => {
  it('combines stored policy with the live catalog', async () => {
    mockGetSystemSetting.mockResolvedValue(null);
    mockListEduAiModels.mockResolvedValue([
      catalogModel({ id: '1', modelId: 'gemini-2.5-flash', name: 'Gemini Flash', provider: 'google' }),
    ]);

    const state = await getAiModelPolicyState();

    expect(state.availableModelsError).toBeNull();
    expect(state.availableModels).toHaveLength(1);
    expect(state.availableModels[0]).toMatchObject({
      isAllowedForTutor: true,
      isDefaultTutor: true,
      isDefaultSupervisor: true,
    });
    expect(state.policy.allowedTutorModelIds).toEqual(['google:gemini-2.5-flash']);
  });

  it('degrades to an empty catalog with availableModelsError set when the catalog load fails', async () => {
    mockGetSystemSetting.mockResolvedValue(null);
    mockListEduAiModels.mockRejectedValue(new Error('EduAI unreachable'));

    const state = await getAiModelPolicyState();

    expect(state.availableModels).toEqual([]);
    expect(state.availableModelsError).toContain('EduAI unreachable');
    // Policy is still resolved (against an empty catalog) so the admin UI can render.
    expect(state.policy).toBeDefined();
  });
});

describe('setAiModelPolicy', () => {
  const models = [
    catalogModel({ id: '1', modelId: 'gemini-2.5-flash', name: 'Gemini Flash', provider: 'google' }),
    catalogModel({ id: '2', modelId: 'o1', name: 'o1', provider: 'openai' }),
  ];

  it('throws when the resolved allow-list is empty', async () => {
    mockListEduAiModels.mockResolvedValue([]);

    await expect(setAiModelPolicy({ allowedTutorModelIds: [] })).rejects.toThrow(
      'At least one tutor model must be allowed',
    );
    expect(mockSetSystemSetting).not.toHaveBeenCalled();
  });

  // Note: setAiModelPolicy's "defaultTutorModelId must be one of the allowed
  // tutor models" check is defensive dead code under normal input —
  // resolveAiModelPolicy always resolves defaultTutorModelId to a member of
  // its own (non-empty) allowedTutorModelIds via getPreferredDefaultModelId's
  // fallback, so it cannot be exercised through the public setAiModelPolicy
  // contract without a non-empty allow-list that resolveAiModelPolicy itself
  // would already repair.

  it('throws when defaultSupervisorModelId is not an available model', async () => {
    // With an empty catalog, resolveAiModelPolicy trusts the caller's raw
    // ids as-is (normalizedModelIds.length === 0 short-circuits its filters),
    // so the allow-list/default-tutor checks pass — but the final check here
    // compares against the real (empty) availableModelIds and must still reject.
    mockListEduAiModels.mockResolvedValue([]);

    await expect(
      setAiModelPolicy({
        allowedTutorModelIds: ['ghost:model'],
        defaultTutorModelId: 'ghost:model',
        defaultSupervisorModelId: 'ghost:model',
      }),
    ).rejects.toThrow('defaultSupervisorModelId must reference an available model');
  });

  it('persists the resolved policy and returns the refreshed state on success', async () => {
    mockListEduAiModels.mockResolvedValue(models);
    mockSetSystemSetting.mockResolvedValue({});
    mockGetSystemSetting.mockResolvedValue(null);

    const result = await setAiModelPolicy({
      allowedTutorModelIds: ['google:gemini-2.5-flash', 'openai:o1'],
      defaultTutorModelId: 'google:gemini-2.5-flash',
      defaultSupervisorModelId: 'openai:o1',
    });

    expect(mockSetSystemSetting).toHaveBeenCalledWith(
      'AI_MODEL_POLICY',
      expect.stringContaining('google:gemini-2.5-flash'),
    );
    // Returns getAiModelPolicyState() — re-reads the (mocked) stored setting.
    expect(result.availableModels).toBeDefined();
  });
});

describe('resolveTutorModelSelection', () => {
  it('throws a 403 when the requested model is not on the allow-list', async () => {
    mockGetSystemSetting.mockResolvedValue({
      value: JSON.stringify({ allowedTutorModelIds: ['google:gemini-2.5-flash'] }),
    });

    await expect(resolveTutorModelSelection('openai:o1')).rejects.toMatchObject({ status: 403 });
  });

  it('returns the requested model when it is allowed', async () => {
    mockGetSystemSetting.mockResolvedValue({
      value: JSON.stringify({ allowedTutorModelIds: ['google:gemini-2.5-flash', 'openai:o1'] }),
    });

    await expect(resolveTutorModelSelection('openai:o1')).resolves.toBe('openai:o1');
  });

  it('falls back to the policy default when no model is requested', async () => {
    mockGetSystemSetting.mockResolvedValue({
      value: JSON.stringify({
        allowedTutorModelIds: ['openai:o1'],
        defaultTutorModelId: 'openai:o1',
      }),
    });

    await expect(resolveTutorModelSelection(undefined)).resolves.toBe('openai:o1');
  });

  it('falls back to DEFAULT_TUTOR_MODEL when nothing is requested and no default is stored', async () => {
    mockGetSystemSetting.mockResolvedValue(null);

    await expect(resolveTutorModelSelection(undefined)).resolves.toBe(DEFAULT_TUTOR_MODEL);
  });

  it('allows any catalog model when the allow-list is empty (unrestricted within the catalog)', async () => {
    mockGetSystemSetting.mockResolvedValue(null);
    mockListEduAiModels.mockResolvedValue([
      catalogModel({ id: '1', modelId: 'gemini-2.5-flash', name: 'Gemini Flash', provider: 'google' }),
    ]);

    await expect(resolveTutorModelSelection('google:gemini-2.5-flash')).resolves.toBe(
      'google:gemini-2.5-flash',
    );
  });

  it('rejects a hallucinated model id even when the allow-list is empty (catalog-constrained)', async () => {
    mockGetSystemSetting.mockResolvedValue(null);
    mockListEduAiModels.mockResolvedValue([
      catalogModel({ id: '1', modelId: 'gemini-2.5-flash', name: 'Gemini Flash', provider: 'google' }),
    ]);

    await expect(resolveTutorModelSelection('anything:goes')).rejects.toMatchObject({ status: 403 });
  });
});

describe('resolveSupervisorSettings', () => {
  it('uses the stored supervisor model when present', async () => {
    mockGetSystemSetting.mockResolvedValue({
      value: JSON.stringify({
        defaultSupervisorModelId: 'openai:o1',
        dualLoopEnabled: false,
        maxSupervisorIterations: 5,
      }),
    });

    const result = await resolveSupervisorSettings();

    expect(result).toEqual({
      dualLoopEnabled: false,
      maxSupervisorIterations: 5,
      supervisorModelId: 'openai:o1',
    });
  });

  it('falls back to the tutor default when no supervisor model is stored', async () => {
    mockGetSystemSetting.mockResolvedValue({
      value: JSON.stringify({ defaultTutorModelId: 'openai:o1' }),
    });

    const result = await resolveSupervisorSettings();

    expect(result.supervisorModelId).toBe('openai:o1');
  });

  it('falls back to DEFAULT_TUTOR_MODEL when neither supervisor nor tutor default is stored', async () => {
    mockGetSystemSetting.mockResolvedValue(null);

    const result = await resolveSupervisorSettings();

    expect(result.supervisorModelId).toBe(DEFAULT_TUTOR_MODEL);
  });
});
