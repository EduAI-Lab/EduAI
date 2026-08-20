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
export function errorResponse(error: unknown): Response {
  const { status, code, fields } = normalizeError(error);
  return apiError(status, code, fields);
}

/**
 * Run a loader/action body, converting anything it throws into the envelope.
 *
 * React Router treats a thrown `Response` as the response to send, so a route
 * that throws `redirect(...)` or a 404 `Response` must keep that behaviour —
 * those are rethrown untouched rather than being mapped.
 */
export async function withErrorResponse<T>(fn: () => Promise<T>): Promise<T | Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Response) throw error;
    return errorResponse(error);
  }
}
