/**
 * Wait for `promise`, but give up as soon as `signal` aborts (#2009).
 *
 * With AI SDK 4, aborting `streamText` (a client disconnect, a Stop, a deadline)
 * makes `result.consumeStream()` return, but `result.text`, `result.usage`,
 * `result.finishReason` and the other result promises never settle. Code that
 * awaits them after the stream therefore hangs forever, and whatever it holds,
 * such as an admission slot, is never released. Racing them against the signal
 * turns that hang into an `AbortError`, which the callers' existing abort paths
 * already clean up after.
 */
export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    // Nobody waits for `promise` any more, but it may still reject (the stream's
    // onError reporting the abort). Unhandled, that rejection exits the Node
    // process, which took Core down mid-E2E-run in the merge queue.
    promise.catch(() => {});
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

/**
 * `Promise.all(values)`, but rejecting as soon as `failed` does (#2009).
 *
 * A provider error inside the stream, such as a prompt over the model's context
 * window, leaves a stream result's promises pending forever, just as an abort
 * does. Callers pass a promise their `streamText` `onError` rejects, so the
 * error ends the wait at once instead of after a deadline.
 */
export function raceStreamFailure<T extends readonly unknown[] | []>(
  failed: Promise<never>,
  values: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  return Promise.race([Promise.all(values), failed]);
}

/** A promise a stream's `onError` rejects, for `raceStreamFailure` (#2009). */
export type StreamFailure = { failed: Promise<never>; fail: (reason: Error) => void };

export function createStreamFailure(): StreamFailure {
  let fail: StreamFailure["fail"] = () => {};
  const failed = new Promise<never>((_, reject) => {
    fail = reject;
  });
  // Rejected only when the stream errors; never an unhandled rejection.
  failed.catch(() => {});
  return { failed, fail };
}
