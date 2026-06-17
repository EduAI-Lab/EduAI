import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/services/eduaiClient.js', () => ({
  getEduAiBaseUrl: () => 'http://core.test/api',
}));
vi.mock('../../src/services/systemSettings.js', () => ({
  getEffectiveEduAiApiKey: vi.fn(),
}));

import {
  getPolicy,
  getPolicies,
  invalidatePolicyCache,
  __resetPolicyServiceState,
} from '../../src/services/policyService.js';
import { getEffectiveEduAiApiKey } from '../../src/services/systemSettings.js';

const FLAG = 'instructors.canCreateCourses';

function okResponse(policies) {
  return { ok: true, json: () => Promise.resolve({ policies }) };
}

describe('policyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetPolicyServiceState();
    getEffectiveEduAiApiKey.mockResolvedValue('service-key');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches Core /policies with the service key and returns the value', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ [FLAG]: false }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await getPolicy(FLAG)).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://core.test/api/policies',
      expect.objectContaining({ headers: { Authorization: 'Bearer service-key' } }),
    );
  });

  it('caches within the TTL — a second read does not re-fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await getPolicies();
    await getPolicies();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves the last known-good value when a later fetch fails', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse({ [FLAG]: false }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getPolicy(FLAG)).toBe(false); // primes lastGood

    invalidatePolicyCache();
    fetchMock.mockRejectedValueOnce(new Error('Core down'));
    expect(await getPolicy(FLAG)).toBe(false); // last good, not a hard fail
  });

  it('falls back to built-in defaults when the first fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Core down')));
    expect(await getPolicy(FLAG)).toBe(true); // default for this flag
  });

  it('falls back to defaults when no service key is configured', async () => {
    getEffectiveEduAiApiKey.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn());
    expect(await getPolicy(FLAG)).toBe(true);
  });
});
