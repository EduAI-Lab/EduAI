/**
 * Canonical failure envelope returned by every chat tool's `execute` function.
 *
 * Design rules (production-grade, scale-safe):
 *
 *  1. Tools MUST NOT throw on expected failures (missing config, upstream
 *     timeout, rate limit, empty result, etc.). They return a `ToolError`
 *     instead. Throws leak as opaque stream-level errors and have historically
 *     produced a stuck UI ("Ready" tool card with no follow-up text), which is
 *     unacceptable when EduAI ships into Canvas at scale.
 *
 *  2. Success payload shapes stay tool-specific. We deliberately do NOT wrap
 *     success in a discriminated `{ ok: true, data }` envelope because that
 *     would force every existing consumer (model, UI, persistence layer) to
 *     learn a new shape. We only normalize failures.
 *
 *  3. Failure detection is structural: any tool result with a non-empty
 *     `error: string` field is treated as a failure by:
 *       - the model (taught in the tool-capable system prompt), and
 *       - the UI (chat-message.tsx `convertToolPart`).
 *     Adding a `code` field gives us stable telemetry buckets without exposing
 *     internal stack traces to users or the model.
 *
 *  4. Every tool execute() should be wrapped in `runTool(name, fn)` so:
 *       - unexpected throws are converted into `{ error, code: "UNKNOWN" }`
 *         (defense in depth — bugs in tool code still produce a graceful
 *         result instead of a stuck UI),
 *       - latency + outcome get a single structured log line for ops/SRE
 *         dashboards once EduAI scales.
 */

export type ToolErrorCode =
  /** Tool dependency or precondition is not set up on this server / session. */
  | "MISSING_CONFIG"
  /** Caller-supplied arguments are unusable; do not retry with same inputs. */
  | "INVALID_INPUT"
  /** Upstream returned a 429 / quota-exceeded signal; retry later. */
  | "RATE_LIMITED"
  /** Network reachability problem (DNS / TCP / TLS / timeout). */
  | "NETWORK_ERROR"
  /** Upstream succeeded but produced nothing usable. */
  | "NO_RESULTS"
  /** Upstream returned a structured error (non-2xx, non-429). */
  | "UPSTREAM_ERROR"
  /** Unknown failure — usually a caught throw from inside execute(). */
  | "UNKNOWN";

/**
 * Minimal structured-error shape every tool may return. Extra fields beyond
 * `error` and `code` are allowed (existing tools like fetchPage attach `url`,
 * `details`, etc.) so this stays backward compatible.
 */
export type ToolError = {
  /** Human-readable message safe to surface in the UI and to feed back to the model. */
  error: string;
  /** Stable, machine-readable code for telemetry, UI badges, and prompt switching. */
  code: ToolErrorCode;
  /**
   * Optional structured details for observability only. NOT shown to the user
   * verbatim; included in tool results so models / debugging can drill in if
   * needed. Tools are free to include extra context here.
   */
  details?: Record<string, unknown>;
};

export function toolError(
  code: ToolErrorCode,
  error: string,
  details?: Record<string, unknown>,
): ToolError {
  return details === undefined ? { error, code } : { error, code, details };
}

/**
 * Detects a `ToolError`. Used by the UI to decide whether to render a tool
 * card as success or as `output-error`.
 *
 * This intentionally matches any object that has a non-empty string `error`
 * field so legacy tool shapes (e.g. `{ error: "..." }` without `code`) still
 * render as errors. Newer tools should always include `code`.
 */
export function isToolError(value: unknown): value is ToolError {
  if (!value || typeof value !== "object") return false;
  const record = value as { error?: unknown };
  return typeof record.error === "string" && record.error.length > 0;
}

// -----------------------------------------------------------------------------
// Observability
// -----------------------------------------------------------------------------

/**
 * One structured log line per tool execution. Kept small and consistent so
 * log aggregators (CloudWatch, Datadog, etc.) can index it by tool + code +
 * latency at scale.
 *
 * We deliberately do NOT log inputs/outputs here — those are PII-adjacent and
 * out of scope for telemetry. If a debugging session needs them, it should
 * use the chat persistence layer (with the appropriate access controls).
 */
export type ToolOutcomeLog = {
  tool: string;
  ok: boolean;
  code?: ToolErrorCode;
  latencyMs: number;
};

export function logToolOutcome(outcome: ToolOutcomeLog): void {
  // Single-line JSON keeps this greppable in dev logs and trivially parseable
  // by log shippers in prod. Prefixed with `[tool]` for easy filtering.
  console.log(`[tool] ${JSON.stringify(outcome)}`);
}

// -----------------------------------------------------------------------------
// runTool wrapper
// -----------------------------------------------------------------------------

/**
 * Wraps a tool's execute body so:
 *  - Unexpected throws are caught and converted to a `ToolError("UNKNOWN", ...)`.
 *  - Every invocation produces exactly one structured outcome log line.
 *  - Tools stay focused on their happy path; cross-cutting concerns live here.
 *
 * Usage:
 *   execute: async (args) => runTool("webSearch", async () => {
 *     ...
 *     if (somethingMissing) return toolError("MISSING_CONFIG", "...");
 *     return successPayload;
 *   })
 */
export async function runTool<T>(
  toolName: string,
  fn: () => Promise<T | ToolError>,
): Promise<T | ToolError> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    const isErr = isToolError(result);
    logToolOutcome({
      tool: toolName,
      ok: !isErr,
      code: isErr ? (result as ToolError).code : undefined,
      latencyMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    logToolOutcome({
      tool: toolName,
      ok: false,
      code: "UNKNOWN",
      latencyMs: Date.now() - startedAt,
    });
    const message = error instanceof Error ? error.message : "Unknown error";
    return toolError(
      "UNKNOWN",
      "An unexpected error occurred while running this tool. Please try again or rephrase your request.",
      { rawError: message },
    );
  }
}
