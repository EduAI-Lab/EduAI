/**
 * Wait until a streamText result has produced a first chunk/step or failed.
 * Used by fleet Slice 2 so connection errors surface before we return the
 * streaming HTTP response (streamText itself resolves immediately).
 */

export type StreamStartupHooks = {
  /** Call when the provider has produced a usable first event. */
  signalReady: () => void;
  /** Call when the provider fails before/during startup. */
  signalError: (cause: unknown) => void;
};

/**
 * Create a probe that resolves on first ready signal or rejects on error.
 * Soft-timeout resolves without error so slow-but-alive hosts are not retried.
 */
/** A startup probe: the hooks a provider signals through, and the wait itself. */
export type StreamStartupProbe = {
  hooks: StreamStartupHooks;
  wait: () => Promise<void>;
};

export function createStreamStartupProbe(options?: { timeoutMs?: number }): StreamStartupProbe {
  // Zero would wait forever and hold an admission slot on a silent provider.
  const timeoutMs = Math.max(1, options?.timeoutMs ?? 10_000);
  let settled = false;
  let resolveReady: () => void = () => {};
  let rejectReady: (cause: unknown) => void = () => {};

  const waitPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const settleReady = () => {
    if (settled) return;
    settled = true;
    resolveReady();
  };

  const settleError = (cause: unknown) => {
    if (settled) return;
    settled = true;
    rejectReady(cause);
  };

  const wait = async () => {
    await Promise.race([
      waitPromise,
      new Promise<void>((resolve) => {
        setTimeout(() => {
          settleReady();
          resolve();
        }, timeoutMs);
      }),
    ]);
  };

  return {
    hooks: {
      signalReady: settleReady,
      signalError: settleError,
    },
    wait,
  };
}
