/**
 * Wait until a streamText result has produced a first chunk/step or failed.
 * Used by fleet Slice 2 so connection errors surface before we return the
 * streaming HTTP response (streamText itself resolves immediately).
 */

export type StreamStartupHooks = {
  /** Call when the provider has produced a usable first event. */
  signalReady: () => void;
  /** Call when the provider fails before/during startup. */
  signalError: (error: unknown) => void;
};

/**
 * Create a probe that resolves on first ready signal or rejects on error.
 * Soft-timeout resolves without error so slow-but-alive hosts are not retried.
 */
export function createStreamStartupProbe(options?: {
  timeoutMs?: number;
}): {
  hooks: StreamStartupHooks;
  wait: () => Promise<void>;
} {
  // Zero would wait forever and hold an admission slot on a silent provider.
  const timeoutMs = Math.max(1, options?.timeoutMs ?? 10_000);
  let settled = false;
  let resolveReady: () => void = () => {};
  let rejectReady: (error: unknown) => void = () => {};

  const waitPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const settleReady = () => {
    if (settled) return;
    settled = true;
    resolveReady();
  };

  const settleError = (error: unknown) => {
    if (settled) return;
    settled = true;
    rejectReady(error);
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
