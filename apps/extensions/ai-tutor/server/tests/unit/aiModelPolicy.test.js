import {
  clampSupervisorIterations,
  normalizeStoredAiModelPolicy,
  resolveAiModelPolicy,
  DEFAULT_TUTOR_MODEL,
  DEFAULT_MAX_SUPERVISOR_ITERATIONS,
} from '../../src/services/aiModelPolicy.js';

// ---------------------------------------------------------------------------
// clampSupervisorIterations
// ---------------------------------------------------------------------------
describe('clampSupervisorIterations', () => {
  it('returns default 3 for NaN', () => {
    expect(clampSupervisorIterations(NaN)).toBe(3);
  });

  it('returns default 3 for Infinity', () => {
    expect(clampSupervisorIterations(Infinity)).toBe(3);
  });

  it('clamps null (coerced to 0) up to minimum 1', () => {
    // Number(null) === 0, which is finite, so it clamps to min (1)
    expect(clampSupervisorIterations(null)).toBe(1);
  });

  it('returns default 3 for undefined', () => {
    expect(clampSupervisorIterations(undefined)).toBe(3);
  });

  it('returns default 3 for non-numeric string "abc"', () => {
    expect(clampSupervisorIterations('abc')).toBe(3);
  });

  it('coerces numeric string "4" to 4', () => {
    expect(clampSupervisorIterations('4')).toBe(4);
  });

  it('clamps 0 up to the minimum of 1', () => {
    expect(clampSupervisorIterations(0)).toBe(1);
  });

  it('clamps 6 down to the maximum of 5', () => {
    expect(clampSupervisorIterations(6)).toBe(5);
  });

  it('truncates 3.7 to 3', () => {
    expect(clampSupervisorIterations(3.7)).toBe(3);
  });

  it('returns 2 unchanged when within range', () => {
    expect(clampSupervisorIterations(2)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// normalizeStoredAiModelPolicy
// ---------------------------------------------------------------------------
describe('normalizeStoredAiModelPolicy', () => {
  it('returns full defaults when called with no arguments', () => {
    const result = normalizeStoredAiModelPolicy();
    expect(result).toEqual({
      allowedTutorModelIds: [],
      defaultTutorModelId: null,
      defaultSupervisorModelId: null,
      dualLoopEnabled: true,
      maxSupervisorIterations: DEFAULT_MAX_SUPERVISOR_ITERATIONS,
    });
  });

  it('returns full defaults when called with empty object', () => {
    const result = normalizeStoredAiModelPolicy({});
    expect(result).toEqual({
      allowedTutorModelIds: [],
      defaultTutorModelId: null,
      defaultSupervisorModelId: null,
      dualLoopEnabled: true,
      maxSupervisorIterations: 3,
    });
  });

  it('filters non-string values from allowedTutorModelIds', () => {
    const result = normalizeStoredAiModelPolicy({
      allowedTutorModelIds: ['model-a', 42, null, undefined, true, 'model-b'],
    });
    expect(result.allowedTutorModelIds).toEqual(['model-a', 'model-b']);
  });

  it('filters empty/whitespace-only strings from allowedTutorModelIds', () => {
    const result = normalizeStoredAiModelPolicy({
      allowedTutorModelIds: ['model-a', '', '   ', 'model-b'],
    });
    expect(result.allowedTutorModelIds).toEqual(['model-a', 'model-b']);
  });

  it('deduplicates allowedTutorModelIds', () => {
    const result = normalizeStoredAiModelPolicy({
      allowedTutorModelIds: ['model-a', 'model-b', 'model-a', 'model-b'],
    });
    expect(result.allowedTutorModelIds).toEqual(['model-a', 'model-b']);
  });

  it('trims whitespace from defaultTutorModelId', () => {
    const result = normalizeStoredAiModelPolicy({
      defaultTutorModelId: '  model-a  ',
    });
    expect(result.defaultTutorModelId).toBe('model-a');
  });

  it('converts empty string defaultTutorModelId to null', () => {
    const result = normalizeStoredAiModelPolicy({
      defaultTutorModelId: '',
    });
    expect(result.defaultTutorModelId).toBeNull();
  });

  it('converts whitespace-only defaultTutorModelId to null', () => {
    const result = normalizeStoredAiModelPolicy({
      defaultTutorModelId: '   ',
    });
    expect(result.defaultTutorModelId).toBeNull();
  });

  it('preserves dualLoopEnabled false', () => {
    const result = normalizeStoredAiModelPolicy({ dualLoopEnabled: false });
    expect(result.dualLoopEnabled).toBe(false);
  });

  it('defaults dualLoopEnabled to true when undefined', () => {
    const result = normalizeStoredAiModelPolicy({ dualLoopEnabled: undefined });
    expect(result.dualLoopEnabled).toBe(true);
  });

  it('clamps maxSupervisorIterations via clampSupervisorIterations', () => {
    const result = normalizeStoredAiModelPolicy({ maxSupervisorIterations: 10 });
    expect(result.maxSupervisorIterations).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// resolveAiModelPolicy
// ---------------------------------------------------------------------------
describe('resolveAiModelPolicy', () => {
  const PREFERRED = DEFAULT_TUTOR_MODEL; // 'google:gemini-2.5-flash'

  it('makes all available models allowed when policy has no allowed list', () => {
    const available = ['model-a', 'model-b', 'model-c'];
    const result = resolveAiModelPolicy({}, available);
    expect(result.allowedTutorModelIds).toEqual(available);
  });

  it('filters allowed models to only those that are available', () => {
    const policy = { allowedTutorModelIds: ['model-a', 'model-gone', 'model-b'] };
    const available = ['model-a', 'model-b', 'model-c'];
    const result = resolveAiModelPolicy(policy, available);
    expect(result.allowedTutorModelIds).toEqual(['model-a', 'model-b']);
  });

  it('falls back to preferred default model when it is in the allowed list', () => {
    const available = ['model-x', PREFERRED, 'model-y'];
    const result = resolveAiModelPolicy({}, available);
    expect(result.defaultTutorModelId).toBe(PREFERRED);
  });

  it('falls back to first allowed model when preferred is not available', () => {
    const available = ['model-x', 'model-y'];
    const result = resolveAiModelPolicy({}, available);
    expect(result.defaultTutorModelId).toBe('model-x');
  });

  it('keeps defaultTutorModelId when it is in the allowed list', () => {
    const policy = {
      allowedTutorModelIds: ['model-a', 'model-b'],
      defaultTutorModelId: 'model-b',
    };
    const available = ['model-a', 'model-b'];
    const result = resolveAiModelPolicy(policy, available);
    expect(result.defaultTutorModelId).toBe('model-b');
  });

  it('resets defaultTutorModelId when it is not in the allowed list', () => {
    const policy = {
      allowedTutorModelIds: ['model-a', 'model-b'],
      defaultTutorModelId: 'model-gone',
    };
    const available = ['model-a', 'model-b'];
    const result = resolveAiModelPolicy(policy, available);
    // Falls back to preferred default logic over the allowed set
    expect(result.defaultTutorModelId).toBe('model-a');
  });

  it('resolves supervisor model from stored value when available', () => {
    const policy = {
      defaultSupervisorModelId: 'supervisor-model',
    };
    const available = ['model-a', 'supervisor-model'];
    const result = resolveAiModelPolicy(policy, available);
    expect(result.defaultSupervisorModelId).toBe('supervisor-model');
  });

  it('falls back supervisor model to tutor default when stored supervisor is unavailable', () => {
    const policy = {
      allowedTutorModelIds: ['model-a'],
      defaultTutorModelId: 'model-a',
      defaultSupervisorModelId: 'supervisor-gone',
    };
    const available = ['model-a'];
    const result = resolveAiModelPolicy(policy, available);
    expect(result.defaultSupervisorModelId).toBe('model-a');
  });

  it('falls back supervisor model to preferred when both stored and tutor are null', () => {
    const available = [PREFERRED, 'model-b'];
    const result = resolveAiModelPolicy({}, available);
    // defaultTutorModelId will be PREFERRED, supervisor falls back to that
    expect(result.defaultSupervisorModelId).toBe(PREFERRED);
  });

  it('returns empty/null everything when both available and policy are empty', () => {
    const result = resolveAiModelPolicy({}, []);
    expect(result).toEqual({
      allowedTutorModelIds: [],
      defaultTutorModelId: null,
      defaultSupervisorModelId: null,
      dualLoopEnabled: true,
      maxSupervisorIterations: DEFAULT_MAX_SUPERVISOR_ITERATIONS,
    });
  });
});
