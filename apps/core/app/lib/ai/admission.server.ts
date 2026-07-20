/**
 * Process-local FIFO admission for interactive local-GPU chat (vLLM / Ollama).
 *
 * Env:
 *   AI_MAX_INFLIGHT       max concurrent LLM slots (default 8; 0 = disabled)
 *   AI_ADMISSION_WAIT_MS  max wait for a slot (default 15000)
 */

import { parseEnvInt } from "~/lib/auth/rate-limit.server";

export class AdmissionTimeoutError extends Error {
  constructor(message = "AI admission queue timed out") {
    super(message);
    this.name = "AdmissionTimeoutError";
  }
}

type Waiter = {
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let inflight = 0;
const waiters: Waiter[] = [];

function maxInflight(): number {
  return parseEnvInt(process.env.AI_MAX_INFLIGHT, 8);
}

function waitMs(): number {
  return parseEnvInt(process.env.AI_ADMISSION_WAIT_MS, 15_000);
}

/** Unit tests / process reset. */
export function resetAiAdmission(): void {
  while (waiters.length > 0) {
    const w = waiters.shift()!;
    clearTimeout(w.timer);
    w.reject(new Error("admission reset"));
  }
  inflight = 0;
}

export function getAiAdmissionStats(): { inflight: number; queued: number; max: number } {
  return { inflight, queued: waiters.length, max: maxInflight() };
}

function releaseSlot(): void {
  inflight = Math.max(0, inflight - 1);
  const next = waiters.shift();
  if (!next) return;
  clearTimeout(next.timer);
  inflight += 1;
  next.resolve(releaseSlot);
}

/**
 * Acquire one LLM slot. Returns a release function that must run when the
 * stream ends, the client aborts, or the request errors.
 * When AI_MAX_INFLIGHT is 0, returns a no-op release immediately.
 */
export async function acquireAiAdmission(): Promise<{
  release: () => void;
  waitedMs: number;
}> {
  const max = maxInflight();
  if (max <= 0) {
    return { release: () => {}, waitedMs: 0 };
  }

  const started = Date.now();
  if (inflight < max) {
    inflight += 1;
    return { release: releaseSlot, waitedMs: 0 };
  }

  const timeout = waitMs();
  return new Promise((resolve, reject) => {
    const waiter: Waiter = {
      resolve: (release) => {
        resolve({ release, waitedMs: Date.now() - started });
      },
      reject,
      timer: setTimeout(() => {
        const idx = waiters.indexOf(waiter);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new AdmissionTimeoutError());
      }, timeout),
    };
    waiters.push(waiter);
  });
}

/**
 * Pipe a streaming Response and invoke `release` when the body ends, errors, or cancels.
 * For non-streaming / empty-body responses, releases immediately.
 */
export function withAdmissionRelease(
  response: Response,
  release: (() => void) | null | undefined,
): Response {
  if (!release) return response;
  if (!response.body) {
    release();
    return response;
  }

  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    release();
  };

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const reader = response.body.getReader();

  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
      await writer.close();
    } catch (err) {
      try {
        await writer.abort(err);
      } catch {
        /* ignore */
      }
    } finally {
      releaseOnce();
    }
  })();

  return new Response(readable, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
