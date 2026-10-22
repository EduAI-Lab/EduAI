/**
 * One `api_request_logs` row per request made with an API key (#2039): who,
 * which key, which model, the outcome and token usage. Never the prompt or the
 * answer. The rows are also what per-user daily limits are counted from.
 *
 * A request that goes on to a model is recorded when it starts (`begin`), with
 * an estimated token charge, and the row is updated when it ends. Recording it
 * only at the end let a client that aborts streams start any number of model
 * calls before a single row existed, and an aborted call whose usage never
 * arrives would have counted as no tokens at all (#2040 review). A request
 * turned away before any model call is recorded once, at the end.
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

/** `status` of a row whose request is still running. Counted against the limits. */
export const API_REQUEST_IN_FLIGHT = 0;

/** Accept only usable token counts from the provider; anything else is unknown. */
function tokenCount(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

/** Rough characters-per-token for English text, used only for the up-front charge. */
const CHARS_PER_TOKEN = 4;

/**
 * Tokens a request may use: its prompt at about four characters a token, plus
 * every output token it allows. Deliberately on the high side, since it is what
 * the request is charged when the provider never reports real usage.
 */
export function estimateRequestTokens(promptChars: number, maxOutputTokens: number): number {
  return Math.ceil(Math.max(0, promptChars) / CHARS_PER_TOKEN) + Math.max(0, maxOutputTokens);
}

export type ApiRequestLogger = {
  setModel(model: string): void;
  setUsage(usage: ApiTokenUsage | null | undefined): void;
  /**
   * Record the request as running, charged `estimatedTokens`, before it reaches
   * a model. False if the row could not be written.
   */
  begin(estimatedTokens: number): Promise<boolean>;
  /** Write the final row once; later calls are ignored. */
  finish(status: number): void;
  /** Write the final row once `usage` settles, or with the estimate after `timeoutMs`. */
  finishWhenSettled(status: number, usage: PromiseLike<ApiTokenUsage>, timeoutMs: number): void;
  readonly finished: boolean;
};

export function startApiRequestLog(caller: ApiKeyCaller, route: string): ApiRequestLogger {
  const startedAt = Date.now();
  let model: string | null = null;
  let usage: ApiTokenUsage | null = null;
  let finished = false;
  /** Set by `begin`: the running row and what it was charged. */
  let started: { id: string; estimatedTokens: number } | null = null;

  const write = (status: number) => {
    const promptTokens = tokenCount(usage?.promptTokens);
    const completionTokens = tokenCount(usage?.completionTokens);
    const reportedTotal =
      tokenCount(usage?.totalTokens) ??
      (promptTokens !== null || completionTokens !== null
        ? (promptTokens ?? 0) + (completionTokens ?? 0)
        : null);
    const durationMs = Date.now() - startedAt;

    if (started) {
      // Keep the estimate when the provider never said what was used.
      fireAndForget(
        prisma.apiRequestLog.update({
          where: { id: started.id },
          data: {
            model,
            status,
            promptTokens,
            completionTokens,
            totalTokens: reportedTotal ?? started.estimatedTokens,
            tokensEstimated: reportedTotal === null,
            durationMs,
          },
        }),
      );
      return;
    }

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
          totalTokens: reportedTotal,
          durationMs,
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
    async begin(estimatedTokens) {
      if (started || finished) return started !== null;
      try {
        const row = await prisma.apiRequestLog.create({
          data: {
            userId: caller.userId,
            apiKeyId: caller.apiKeyId,
            grantId: caller.grantId,
            route,
            model,
            status: API_REQUEST_IN_FLIGHT,
            totalTokens: estimatedTokens,
            tokensEstimated: true,
          },
          select: { id: true },
        });
        started = { id: row.id, estimatedTokens };
        return true;
      } catch (error) {
        console.error("[api-request-log] could not record the request start", error);
        return false;
      }
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
