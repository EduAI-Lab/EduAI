import { AppError } from "@eduai/types";
import type { AppErrorOptions } from "@eduai/types";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

/**
 * Infrastructure outage on the enqueue path (Redis down, DB unreachable, etc.).
 * Routes must map this to HTTP 503 — never 400 (#1112).
 */
export class QueueUnavailableError extends AppError {
  // Kept as literal types: callers narrow on these, and #1112's contract is
  // specifically that this error is a 503.
  readonly status = 503 as const;
  readonly code = "QUEUE_UNAVAILABLE" as const;

  constructor(message = "Queue unavailable", options?: { cause?: unknown }) {
    const appErrorOptions: AppErrorOptions = {
      code: "QUEUE_UNAVAILABLE",
      expose: true,
    };
    // Only set `cause` when one was actually supplied — `{ cause: undefined }`
    // still defines the property, which changes how the error serialises.
    if (options?.cause !== undefined) appErrorOptions.cause = options.cause;
    super(503, message, appErrorOptions);
    this.name = "QueueUnavailableError";
  }
}

/** Prisma codes that mean the database itself is unreachable / timed out. */
const PRISMA_INFRA_CODES = new Set([
  "P1001", // can't reach DB server
  "P1002", // DB server timed out
  "P1008", // operations timed out
  "P1017", // server closed the connection
  "P2024", // timed out fetching a connection from the pool (pool exhaustion)
]);

const INFRA_MESSAGE_RE =
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|Redis|Connection is closed|connect ECONNREFUSED/i;

/**
 * True when `error` is an infrastructure failure (Redis / DB connectivity),
 * as opposed to a validation or application fault.
 */
export function isInfrastructureError(error: unknown): boolean {
  if (error instanceof QueueUnavailableError) return true;

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return PRISMA_INFRA_CODES.has(error.code);
  }
  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return true;
  }

  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && (PRISMA_INFRA_CODES.has(code) || INFRA_MESSAGE_RE.test(code))) {
      return true;
    }
  }

  if (error instanceof Error) {
    if (INFRA_MESSAGE_RE.test(error.message)) return true;
    if (error.cause && isInfrastructureError(error.cause)) return true;
  }

  return false;
}

/** HTTP status for an enqueue/re-embed start failure (#1112). */
export function httpStatusForEnqueueError(error: unknown): number {
  if (error instanceof ZodError) return 400;
  if (error instanceof QueueUnavailableError) return 503;
  if (isInfrastructureError(error)) return 503;
  return 500;
}

export function toQueueUnavailable(
  error: unknown,
  message = "Queue unavailable",
): QueueUnavailableError {
  if (error instanceof QueueUnavailableError) return error;
  return new QueueUnavailableError(message, { cause: error });
}
