/**
 * PR #1304 review (yta3216): removing the `useAiServicesStatus` 60s heartbeat
 * was correct (genuinely dead code), but `useEduAIStatus`'s error-path backoff
 * loop was the sole automatic-recovery mechanism for a transient AI-services
 * outage — without it the status badge/banner latch on "error" for the whole
 * page lifetime once it errors once, since the initial probe is a module-import
 * side effect that only runs once.
 *
 * These tests assert the restored behavior: after an error, the hook
 * automatically retries with backoff and can recover to "ok" without any
 * user interaction (no manual refresh(), no chip click).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const testApiKey = vi.fn();

vi.mock('@/services/eduaiService', () => ({
    default: { testApiKey: (...args: unknown[]) => testApiKey(...args) },
}));

vi.mock('@/services/apiKeyStorage', () => ({
    apiKeyStorage: { getAllApiKeys: vi.fn().mockResolvedValue({}) },
    isCloudProvider: () => false,
}));

/** Flushes pending microtasks (promise chains) without touching macrotask timers. */
const flushMicrotasks = async () => {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
};

describe('useEduAIStatus automatic recovery', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        testApiKey.mockReset();
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('automatically retries after an error and recovers to ok without manual refresh', async () => {
        // First probe (module-import side effect) fails; subsequent background
        // retry succeeds — simulating a transient outage clearing on its own.
        testApiKey.mockRejectedValueOnce(new Error('network down'));
        testApiKey.mockResolvedValueOnce({ success: true, provider: 'vllm' });

        const { useEduAIStatus } = await import('@/hooks/useEduAIStatus');

        // Let the module's own initial probe (fired on import) settle.
        await act(async () => {
            await flushMicrotasks();
        });

        const { result } = renderHook(() => useEduAIStatus());

        expect(result.current.status).toBe('error');
        expect(testApiKey).toHaveBeenCalledTimes(1);

        // No manual refresh() call — advancing time alone should trigger the
        // backoff retry (first delay is 1s) and flip status to 'ok'.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
            await flushMicrotasks();
        });

        expect(result.current.status).toBe('ok');
        expect(testApiKey).toHaveBeenCalledTimes(2);
    });

    it('gives up retrying after the max attempt count on a persistent outage', async () => {
        testApiKey.mockRejectedValue(new Error('still down'));

        const { useEduAIStatus } = await import('@/hooks/useEduAIStatus');

        await act(async () => {
            await flushMicrotasks();
        });

        const { result } = renderHook(() => useEduAIStatus());
        expect(result.current.status).toBe('error');

        // Advance well past the bounded backoff window (1+2+4+8+8+8s = 31s)
        // plus slack, flushing microtasks between ticks so each retry's async
        // fetchStatus() resolves before the next timer is scheduled.
        for (let i = 0; i < 20; i++) {
            await act(async () => {
                await vi.advanceTimersByTimeAsync(10_000);
                await flushMicrotasks();
            });
        }

        const callsAfterExhaustion = testApiKey.mock.calls.length;
        expect(callsAfterExhaustion).toBeGreaterThan(1);
        expect(callsAfterExhaustion).toBeLessThanOrEqual(7); // initial + MAX_RETRIES
        expect(result.current.status).toBe('error');

        await act(async () => {
            await vi.advanceTimersByTimeAsync(60_000);
            await flushMicrotasks();
        });
        expect(testApiKey.mock.calls.length).toBe(callsAfterExhaustion);
    });
});
