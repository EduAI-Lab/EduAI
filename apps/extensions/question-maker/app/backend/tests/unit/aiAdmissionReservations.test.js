import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/settings.js', () => ({
  config: {
    qmAiRateLimitWindowMs: 60_000,
    qmAiProviderCallLimit: 60,
  },
}));

const {
  reserveQmAiProviderCalls,
  resetQmAiAdmissionForTests,
  setQmAiProviderReservationLimitForTests,
  qmAiCallerKey,
} = await import('../../src/middleware/aiAdmission.js');

function reqFor(id) {
  return { user: { id } };
}

describe('QM AI provider reservation LRU eviction', () => {
  afterEach(() => {
    resetQmAiAdmissionForTests();
    setQmAiProviderReservationLimitForTests(10_000);
  });

  it('evicts the least-recently-refreshed identity, not a just-refreshed caller', () => {
    setQmAiProviderReservationLimitForTests(2);

    const a = reqFor('A');
    const b = reqFor('B');
    const c = reqFor('C');
    expect(qmAiCallerKey(a)).toBe('qm-ai:user:A');

    expect(reserveQmAiProviderCalls(a, 5)).toMatchObject({ ok: true, used: 5 });
    expect(reserveQmAiProviderCalls(b, 7)).toMatchObject({ ok: true, used: 7 });
    // Refresh A so insertion order is B (LRU), then A. Inserting C must evict B.
    expect(reserveQmAiProviderCalls(a, 3)).toMatchObject({ ok: true, used: 8 });
    expect(reserveQmAiProviderCalls(c, 2)).toMatchObject({ ok: true, used: 2 });

    const retainedA = reserveQmAiProviderCalls(a, 1);
    expect(retainedA.ok).toBe(true);
    expect(retainedA.used).toBe(9);
  });

  it('resets used to 0 for an evicted identity while retaining the live caller budget', () => {
    setQmAiProviderReservationLimitForTests(2);

    const a = reqFor('A');
    const b = reqFor('B');
    const c = reqFor('C');

    expect(reserveQmAiProviderCalls(a, 5)).toMatchObject({ ok: true, used: 5 });
    expect(reserveQmAiProviderCalls(b, 7)).toMatchObject({ ok: true, used: 7 });
    expect(reserveQmAiProviderCalls(a, 3)).toMatchObject({ ok: true, used: 8 });
    expect(reserveQmAiProviderCalls(c, 2)).toMatchObject({ ok: true, used: 2 });

    // Observe the retained identity first so inserting B again does not
    // immediately evict A at cap 2.
    const retainedA = reserveQmAiProviderCalls(a, 1);
    expect(retainedA.ok).toBe(true);
    expect(retainedA.used).toBeGreaterThan(0);
    expect(retainedA.used).toBe(9);

    const evictedB = reserveQmAiProviderCalls(b, 1);
    expect(evictedB.ok).toBe(true);
    expect(evictedB.used).toBe(1);
  });
});
