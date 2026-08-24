/**
 * Core's route-boundary error mapper (#1279).
 *
 * Core has no Express-style middleware — React Router calls each loader and
 * action directly — so the "one mapper per app" this issue asks for is a
 * function that routes wrap their body in, rather than a `app.use(...)`.
 *
 * The envelope is unchanged: `{ error: "CODE", fields?: { field: "message" } }`,
 * built through the existing `apiError` helper so nothing about the wire
 * format moves. What changes is where the decision is made — routes throw
 * typed errors and this maps them, instead of each route choosing a status and
 * hand-writing a body.
 */
import { normalizeError } from "@eduai/types";

import { apiError } from "./api-error.server";
import { fireAndForget, logSystemError } from "./logging.server";

export {
  AppError,
  AuthError,
  ConflictError,
  ForbiddenError,
  isAppError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "@eduai/types";

/**
 * Map any thrown value to Core's error envelope.
 *
 * Note the envelope's `error` key holds the machine-readable CODE, not the
 * message — that is Core's existing contract and the MCP clients depend on it.
 * The human-readable message is deliberately dropped for unrecognised errors;
 * for recognised ones it is not part of this envelope either, so no internal
 * text can reach the client through this path.
 */
export function errorResponse(cause: unknown): Response {
  const { status, code, fields } = normalizeError(cause);
  return apiError(status, code, fields);
}

/** Route/request context recorded alongside a logged boundary failure. */
export interface RouteErrorContext {
  /** The incoming request — its method and path are recorded for triage. */
  request?: Request;
}

/**
 * Run a loader/action body, converting anything it throws into the envelope.
 *
 * React Router treats a thrown `Response` as the response to send, so a route
 * that throws `redirect(...)` or a 404 `Response` must keep that behaviour —
 * those are rethrown untouched rather than being mapped.
 *
 * Server-side failures — a Prisma/transport outage (503), a bug (500) — are
 * logged before they are mapped. Once the boundary swallows a throw into the
 * envelope, React Router's server `onError` hook never sees it, so without this
 * the failure would disappear from operational logs. The discriminator is the
 * mapped status: `>= 500` is an operational failure worth an ERROR log, while a
 * 4xx is a client error the route deliberately produced and is left unlogged.
 * (A 503 connectivity error exposes only a generic message, so the `exposed`
 * flag can't stand in here — the outage behind it still needs logging.) Logging
 * is fire-and-forget and the payload is redacted downstream in `logSystemError`,
 * so it never adds latency or leaks.
 */
export async function withErrorResponse<T>(
  fn: () => Promise<T>,
  context: RouteErrorContext = {},
): Promise<T | Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Response) throw error;
    const { status, code, fields } = normalizeError(error);
    if (status >= 500) {
      const url = context.request ? new URL(context.request.url) : undefined;
      fireAndForget(
        logSystemError({
          source: "API",
          code,
          message: `Unhandled route error mapped to ${status}`,
          error,
          statusCode: status,
          routePath: url?.pathname ?? null,
          httpMethod: context.request?.method ?? null,
        }),
      );
    }
    return apiError(status, code, fields);
  }
}
