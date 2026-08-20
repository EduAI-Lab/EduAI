/**
 * Shared typed-error hierarchy for every EduAI app (#1279).
 *
 * Modelled on Core's `QueueUnavailableError`, which was the only real typed
 * error in the repo and already documented the contract this generalises:
 * an error carries the HTTP status and the stable machine-readable code that
 * the route boundary should surface, so no route has to hand-roll either.
 *
 * Deliberately dependency-free. Both `ai-tutor/server` and `question-maker`'s
 * backend are plain JavaScript and each bundles a *different* Prisma client
 * (`@prisma/client` vs `@eduai/question-maker-prisma-client`), so this module
 * never imports Prisma or Zod. Framework-shaped errors are recognised by
 * duck-typing instead — see `normalizeError`.
 *
 * `message` is developer-facing by default and is NOT sent to clients unless
 * the error opts in via `expose`. Every subclass here exposes its message,
 * because those messages are authored for users; anything unrecognised is
 * reported as a generic 500 so raw Prisma / transport text can never leak.
 */

/** Machine-readable codes carried by the built-in error classes. */
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Per-field validation messages, keyed by field name. */
export type ErrorFields = Record<string, string>;

export interface AppErrorOptions {
  /** Machine-readable code clients branch on. Defaults to the subclass code. */
  code?: string;
  /** Per-field messages, for validation failures. */
  fields?: ErrorFields;
  /** Underlying error, preserved for logs. Never sent to clients. */
  cause?: unknown;
  /**
   * Whether `message` is safe to send to the client. Every subclass defaults
   * this to `true`; construct `AppError` directly with `expose: false` to log
   * a detailed message while returning the generic envelope.
   */
  expose?: boolean;
}

/**
 * Base class for errors that carry their own HTTP status and code.
 *
 * Route boundaries map these directly; anything else becomes a 500 with a
 * generic message.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: ErrorFields;
  readonly expose: boolean;

  constructor(status: number, message: string, options: AppErrorOptions = {}) {
    // Only pass `cause` when it was actually supplied — `{ cause: undefined }`
    // still defines the property, which changes how the error serialises.
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.status = status;
    this.code = options.code ?? "INTERNAL_ERROR";
    this.expose = options.expose ?? false;
    if (options.fields) this.fields = options.fields;
  }
}

/**
 * 400/422 — request body or params failed validation.
 *
 * Defaults to 422, which is what Core already returned from
 * `validationErrorFromZod`. **The extension backends answer 400** and pass
 * `{ status: 400 }` explicitly at every call site — their clients branch on it.
 * Take the default only if you mean Core's status.
 */
export class ValidationError extends AppError {
  constructor(message = "Validation failed", options: AppErrorOptions & { status?: number } = {}) {
    const { status = 422, ...rest } = options;
    super(status, message, { code: "VALIDATION_ERROR", expose: true, ...rest });
  }
}

/** 401 — no valid credentials were presented. */
export class AuthError extends AppError {
  constructor(message = "Authentication required", options: AppErrorOptions = {}) {
    super(401, message, { code: "UNAUTHENTICATED", expose: true, ...options });
  }
}

/**
 * 403 — authenticated, but not allowed.
 *
 * Distinct from `AuthError` because the two drive different client behaviour:
 * a 401 sends the user to log in, a 403 must not. The apps already made this
 * distinction by hand (ai-tutor alone had 18 "Not authorized for this course"
 * responses), so collapsing them into one class would lose information.
 */
export class ForbiddenError extends AppError {
  constructor(message = "Not authorized", options: AppErrorOptions = {}) {
    super(403, message, { code: "FORBIDDEN", expose: true, ...options });
  }
}

/** 404 — the addressed resource does not exist or is not visible to the caller. */
export class NotFoundError extends AppError {
  constructor(message = "Resource not found", options: AppErrorOptions = {}) {
    super(404, message, { code: "NOT_FOUND", expose: true, ...options });
  }
}

/** 409 — the request conflicts with existing state (uniqueness, concurrent edit). */
export class ConflictError extends AppError {
  constructor(message = "Resource already exists", options: AppErrorOptions = {}) {
    super(409, message, { code: "CONFLICT", expose: true, ...options });
  }
}

/**
 * 503 — a dependency (queue, database, upstream service) is unavailable.
 *
 * Core's `QueueUnavailableError` is the original of this; it now extends this
 * class while keeping its own literal `status`/`code` so the #1112 contract
 * ("routes must map this to 503 — never 400") is unchanged.
 */
export class ServiceUnavailableError extends AppError {
  constructor(message = "Service unavailable", options: AppErrorOptions = {}) {
    super(503, message, { code: "SERVICE_UNAVAILABLE", expose: true, ...options });
  }
}

/** True when `error` is an `AppError` from any copy of this module. */
export function isAppError(error: unknown): error is AppError {
  if (error instanceof AppError) return true;
  // Fall back to structural checks: with workspace symlinks and a tracked
  // `dist/`, an app can end up holding a second realm's copy of this class,
  // where `instanceof` is false for an otherwise identical error.
  if (!(error instanceof Error)) return false;
  const candidate = error as Partial<AppError>;
  return (
    typeof candidate.status === "number" &&
    typeof candidate.code === "string" &&
    typeof candidate.expose === "boolean"
  );
}

/** The shape a route boundary needs in order to build a response. */
export interface NormalizedError {
  status: number;
  code: string;
  /** Client-safe. Generic text whenever the original was not exposable. */
  message: string;
  fields?: ErrorFields;
  /**
   * False when the original message was withheld. Boundaries use this to
   * decide whether to log at `error` level — a withheld message means the
   * failure was unanticipated.
   */
  exposed: boolean;
}

const GENERIC_MESSAGE = "Internal server error";

/**
 * Default `code` for an error that carries a status but no code of its own.
 * Derived from the status so a legacy 404 does not get labelled
 * `VALIDATION_ERROR`.
 */
function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return "UNAUTHENTICATED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 503:
      return "SERVICE_UNAVAILABLE";
    default:
      return status >= 500 ? "INTERNAL_ERROR" : "VALIDATION_ERROR";
  }
}

/**
 * Prisma error codes with an unambiguous HTTP meaning.
 *
 * Matched by code string rather than by `instanceof`, so this works for both
 * Prisma clients in the monorepo without importing either.
 */
const PRISMA_STATUS: Record<string, { status: number; code: ErrorCode }> = {
  P2002: { status: 409, code: "CONFLICT" }, // unique constraint violation
  P2003: { status: 400, code: "VALIDATION_ERROR" }, // foreign key violation
  P2025: { status: 404, code: "NOT_FOUND" }, // required record not found
  // Connectivity / pool failures — the database itself is unreachable.
  P1001: { status: 503, code: "SERVICE_UNAVAILABLE" },
  P1002: { status: 503, code: "SERVICE_UNAVAILABLE" },
  P1008: { status: 503, code: "SERVICE_UNAVAILABLE" },
  P1017: { status: 503, code: "SERVICE_UNAVAILABLE" },
  P2024: { status: 503, code: "SERVICE_UNAVAILABLE" },
};

/**
 * Messages that are safe to show for a mapped Prisma failure. The raw Prisma
 * message is never reused — it embeds model and column names.
 */
const PRISMA_MESSAGE: Record<string, string> = {
  P2002: "Resource already exists",
  P2003: "Referenced resource does not exist",
  P2025: "Resource not found",
};

function isPrismaKnownRequestError(error: unknown): error is { code: string } {
  return (
    error instanceof Error &&
    error.name === "PrismaClientKnownRequestError" &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

/** Zod errors expose `issues`; matched structurally to avoid a zod dependency. */
function isZodError(
  error: unknown,
): error is { issues: Array<{ path: unknown[]; message: string }> } {
  return (
    error instanceof Error &&
    error.name === "ZodError" &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

function fieldsFromZod(error: {
  issues: Array<{ path: unknown[]; message: string }>;
}): ErrorFields {
  const fields: ErrorFields = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".");
    // First message wins, matching Core's existing `validationErrorFromZod`.
    if (key && !(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

/**
 * Reduce any thrown value to the status, code and client-safe message a route
 * boundary should return.
 *
 * Recognises `AppError`, Zod errors, Prisma known-request errors, and the
 * `err.status`/`err.statusCode` convention used by Express and by the apps'
 * existing hand-rolled errors. Everything else becomes a generic 500 — this is
 * what stops raw internal text from reaching clients.
 */
export function normalizeError(error: unknown): NormalizedError {
  if (isAppError(error)) {
    return {
      status: error.status,
      code: error.code,
      message: error.expose ? error.message : GENERIC_MESSAGE,
      ...(error.fields ? { fields: error.fields } : {}),
      exposed: error.expose,
    };
  }

  if (isZodError(error)) {
    return {
      status: 422,
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      fields: fieldsFromZod(error),
      exposed: true,
    };
  }

  if (isPrismaKnownRequestError(error)) {
    const mapped = PRISMA_STATUS[error.code];
    if (mapped) {
      // Deliberately built from the code alone. `error.meta.target` holds the
      // database column names behind the violated constraint, so folding it
      // into the message would disclose internal schema identifiers to the
      // client — the exact thing this module exists to prevent. Callers that
      // want to name a public field do it explicitly, by catching the Prisma
      // error and throwing a `ConflictError`/`ValidationError` with `fields`.
      const message = PRISMA_MESSAGE[error.code] ?? "Service unavailable";
      return { status: mapped.status, code: mapped.code, message, exposed: true };
    }
    // Any other Prisma code is a bug or a schema problem, not a client error.
    return { status: 500, code: "INTERNAL_ERROR", message: GENERIC_MESSAGE, exposed: false };
  }

  // Express (and the apps' pre-#1279 errors) put the status on the error.
  if (error instanceof Error) {
    const withStatus = error as { status?: unknown; statusCode?: unknown };
    const raw = typeof withStatus.status === "number" ? withStatus.status : withStatus.statusCode;
    if (typeof raw === "number" && raw >= 400 && raw < 600) {
      // A 4xx carrying an explicit status was constructed deliberately, so its
      // message is intended for the caller. A 5xx is still withheld.
      const exposed = raw < 500;
      // Only trust `err.code` inside this branch. Transport failures carry a
      // `code` too (`ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT` from the Core
      // fetch paths) and surfacing those would leak infrastructure detail —
      // but they never carry a 4xx/5xx numeric `status`, so they cannot reach
      // here. This is the type-gated rule from question-maker's errorHandler,
      // restated as a status gate so it also covers errors this module has
      // never heard of.
      const ownCode = (error as { code?: unknown }).code;
      const code =
        exposed && typeof ownCode === "string" && ownCode.length > 0 ? ownCode : codeForStatus(raw);
      return {
        status: raw,
        code,
        message: exposed && error.message ? error.message : GENERIC_MESSAGE,
        exposed,
      };
    }
  }

  return { status: 500, code: "INTERNAL_ERROR", message: GENERIC_MESSAGE, exposed: false };
}
