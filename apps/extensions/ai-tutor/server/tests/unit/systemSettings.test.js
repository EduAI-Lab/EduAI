import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockFindUnique = vi.fn();
const mockUpsert = vi.fn();
const mockDelete = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    systemSetting: {
      findUnique: (...args) => mockFindUnique(...args),
      upsert: (...args) => mockUpsert(...args),
      delete: (...args) => mockDelete(...args),
    },
  },
}));

const {
  SYSTEM_SETTING_KEYS,
  getSystemSetting,
  setSystemSetting,
  clearSystemSetting,
  getEffectiveEduAiApiKey,
  getEduAiApiKeyStatus,
} = await import('../../src/services/systemSettings.js');

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpsert.mockReset();
  mockDelete.mockReset();
  delete process.env.EDUAI_API_KEY;
});

afterEach(() => {
  delete process.env.EDUAI_API_KEY;
  vi.restoreAllMocks();
});

describe('getSystemSetting', () => {
  it('returns null without querying when key is falsy', async () => {
    const result = await getSystemSetting('');
    expect(result).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it('queries prisma by key', async () => {
    mockFindUnique.mockResolvedValue({ key: 'K', value: 'V' });
    const result = await getSystemSetting('K');
    expect(result).toEqual({ key: 'K', value: 'V' });
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { key: 'K' } });
  });
});

describe('setSystemSetting', () => {
  it('throws when key is missing', async () => {
    await expect(setSystemSetting('', 'value')).rejects.toThrow('System setting key is required');
  });

  it('throws when value is not a string', async () => {
    await expect(setSystemSetting('K', 42)).rejects.toThrow('System setting value must be a string');
  });

  it('upserts key/value', async () => {
    mockUpsert.mockResolvedValue({ key: 'K', value: 'V' });
    const result = await setSystemSetting('K', 'V');
    expect(result).toEqual({ key: 'K', value: 'V' });
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { key: 'K' },
      update: { value: 'V' },
      create: { key: 'K', value: 'V' },
    });
  });
});

describe('clearSystemSetting', () => {
  it('does nothing when key is falsy', async () => {
    await clearSystemSetting('');
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('deletes the setting by key', async () => {
    mockDelete.mockResolvedValue({});
    await clearSystemSetting('K');
    expect(mockDelete).toHaveBeenCalledWith({ where: { key: 'K' } });
  });

  it('swallows delete errors (e.g. row already gone)', async () => {
    mockDelete.mockRejectedValue(new Error('not found'));
    await expect(clearSystemSetting('K')).resolves.toBeUndefined();
  });
});

describe('getEffectiveEduAiApiKey', () => {
  it('prefers the stored admin override', async () => {
    mockFindUnique.mockResolvedValue({ value: 'admin-key' });
    process.env.EDUAI_API_KEY = 'env-key';
    const result = await getEffectiveEduAiApiKey();
    expect(result).toBe('admin-key');
  });

  it('falls back to the env var when no override is stored', async () => {
    mockFindUnique.mockResolvedValue(null);
    process.env.EDUAI_API_KEY = 'env-key';
    const result = await getEffectiveEduAiApiKey();
    expect(result).toBe('env-key');
  });

  it('returns null when neither override nor env var is set', async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await getEffectiveEduAiApiKey();
    expect(result).toBeNull();
  });

  it('falls back to env when the stored row has an empty value', async () => {
    mockFindUnique.mockResolvedValue({ value: '' });
    process.env.EDUAI_API_KEY = 'env-key';
    const result = await getEffectiveEduAiApiKey();
    expect(result).toBe('env-key');
  });
});

describe('getEduAiApiKeyStatus', () => {
  it('reports source ADMIN when an override is stored', async () => {
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');
    mockFindUnique.mockResolvedValue({ value: 'admin-key', updatedAt });
    process.env.EDUAI_API_KEY = 'env-key';

    const status = await getEduAiApiKeyStatus();

    expect(status).toEqual({
      configured: true,
      source: 'ADMIN',
      hasAdminOverride: true,
      envConfigured: true,
      updatedAt: updatedAt.toISOString(),
    });
  });

  it('reports source ENV when only the env var is set', async () => {
    mockFindUnique.mockResolvedValue(null);
    process.env.EDUAI_API_KEY = 'env-key';

    const status = await getEduAiApiKeyStatus();

    expect(status).toEqual({
      configured: true,
      source: 'ENV',
      hasAdminOverride: false,
      envConfigured: true,
      updatedAt: null,
    });
  });

  it('reports source NONE when nothing is configured', async () => {
    mockFindUnique.mockResolvedValue(null);

    const status = await getEduAiApiKeyStatus();

    expect(status).toEqual({
      configured: false,
      source: 'NONE',
      hasAdminOverride: false,
      envConfigured: false,
      updatedAt: null,
    });
  });

  it('exposes the known system setting keys', () => {
    expect(SYSTEM_SETTING_KEYS).toEqual({
      EDUAI_API_KEY: 'EDUAI_API_KEY',
      AI_MODEL_POLICY: 'AI_MODEL_POLICY',
    });
  });
});
