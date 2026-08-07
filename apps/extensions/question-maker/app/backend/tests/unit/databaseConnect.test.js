/**
 * Unit tests for connectDatabase's retry/failure paths (issue #1217: database.js
 * was only exercised via its happy-path retryOnFailure:false use in
 * tests/helpers/testDb.js — the exponential-backoff retry loop and both
 * allowFailure branches had no coverage).
 *
 * prisma.$queryRaw is mocked directly on the real singleton exported by
 * config/database.js; nothing here opens a real DB connection.
 */
import { vi, describe, it, expect, afterEach } from 'vitest';

const { prisma, connectDatabase } = await import('../../src/config/database.js');

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('connectDatabase', () => {
  it('resolves immediately when the first query succeeds', async () => {
    vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([{ '?column?': 1 }]);

    await expect(connectDatabase({ maxRetries: 3 })).resolves.toBeUndefined();
  });

  it('retries with exponential backoff after transient failures, then succeeds', async () => {
    vi.useFakeTimers();
    const spy = vi
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValueOnce([{ '?column?': 1 }]);

    const promise = connectDatabase({ maxRetries: 5 });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after exhausting max retries (allowFailure: false, the default)', async () => {
    vi.useFakeTimers();
    vi.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error('connection refused'));

    const promise = connectDatabase({ maxRetries: 2 });
    // Attach the rejection assertion before advancing timers so the rejection
    // is never briefly unhandled between the reject and this awaited check.
    const assertion = expect(promise).rejects.toThrow('connection refused');
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('swallows the error and resolves when allowFailure is true', async () => {
    vi.useFakeTimers();
    vi.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error('connection refused'));

    const promise = connectDatabase({ maxRetries: 2, allowFailure: true });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBeUndefined();
  });

  it('does not retry and rethrows immediately when retryOnFailure is false', async () => {
    const spy = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('down'));

    await expect(connectDatabase({ retryOnFailure: false })).rejects.toThrow('down');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('swallows a non-retried failure when allowFailure is true', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('down'));

    await expect(
      connectDatabase({ retryOnFailure: false, allowFailure: true }),
    ).resolves.toBeUndefined();
  });
});
