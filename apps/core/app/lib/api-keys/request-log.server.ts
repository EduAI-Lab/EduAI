/**
 * One `api_request_logs` row per request made with an API key (#2039): who,
 * which key, which model, the outcome and token usage. Never the prompt or the
 * answer. The rows are also what per-user daily limits are counted from.
 */
import { fireAndForget } from "~/lib/logging.server";
import prisma from "~/lib/prisma.server";

export type ApiKeyCaller = {
  userId: string;
  apiKeyId: string;
  /** The grant the key runs under; null for an admin's key. */
  grantId: string | null;
};

export type ApiTokenUsage = {
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
};

/** Accept only usable token counts from the provider; anything else is unknown. */
function tokenCount(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

export type ApiRequestLogger = {
  setModel(model: string): void;
  setUsage(usage: ApiTokenUsage | null | undefined): void;
  /** Write the row once; later calls are ignored. */
  finish(status: number): void;
  /** Write the row once `usage` settles, or without tokens after `timeoutMs`. */
  finishWhenSettled(status: number, usage: PromiseLike<ApiTokenUsage>, timeoutMs: number): void;
  readonly finished: boolean;
};

export function startApiRequestLog(caller: ApiKeyCaller, route: string): ApiRequestLogger {
  const startedAt = Date.now();
  let model: string | null = null;
  let usage: ApiTokenUsage | null = null;
  let finished = false;

  const write = (status: number) => {
    const promptTokens = tokenCount(usage?.promptTokens);
    const completionTokens = tokenCount(usage?.completionTokens);
    const totalTokens =
      tokenCount(usage?.totalTokens) ??
      (promptTokens !== null || completionTokens !== null
        ? (promptTokens ?? 0) + (completionTokens ?? 0)
        : null);
    fireAndForget(
      prisma.apiRequestLog.create({
        data: {
          userId: caller.userId,
          apiKeyId: caller.apiKeyId,
          grantId: caller.grantId,
          route,
          model,
          status,
          promptTokens,
          completionTokens,
          totalTokens,
          durationMs: Date.now() - startedAt,
        },
      }),
    );
  };

  return {
    setModel(value) {
      model = value;
    },
    setUsage(value) {
      usage = value ?? null;
    },
    finish(status) {
      if (finished) return;
      finished = true;
      write(status);
    },
    finishWhenSettled(status, pending, timeoutMs) {
      if (finished) return;
      finished = true;
      // The AI SDK's usage promise can stay pending forever after an abort or a
      // stream error (#2009), so it is raced against a timer, never awaited bare.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
        timer.unref?.();
      });
      void Promise.race([
        Promise.resolve(pending).then(
          (value) => value,
          () => null,
        ),
        timeout,
      ])
        .then((value) => {
          if (value) usage = value;
        })
        .finally(() => {
          clearTimeout(timer);
          write(status);
        });
    },
    get finished() {
      return finished;
    },
  };
}
