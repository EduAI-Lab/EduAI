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
  if (signal.aborted) return Promise.reject(abortError());
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
