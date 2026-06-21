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

  it('fails CLOSED when the first fetch fails (no last-good): a disabled flag is never silently re-enabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Core down')));
    // Cold start during a Core outage: policy state is unknown, so even a
    // default-true flag resolves to false rather than fail-open.
    expect(await getPolicy(FLAG)).toBe(false);
    expect(await getPolicies()).toBe(null);
  });

  it('fails CLOSED when no service key is configured', async () => {
    getEffectiveEduAiApiKey.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn());
    expect(await getPolicy(FLAG)).toBe(false);
  });

  it('applies the per-key built-in default when Core is reachable but omits the key', async () => {
    // Core responds successfully but without this flag (e.g. an older Core).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({})));
    expect(await getPolicy(FLAG)).toBe(true); // POLICY_DEFAULTS fills the gap
  });
});
