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
export declare const ERROR_CODES: readonly ["VALIDATION_ERROR", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR"];
export type ErrorCode = (typeof ERROR_CODES)[number];
/** Per-field validation messages, keyed by field name. */
export type ErrorFields = Record<string, string>;
/**
 * The JSON body an error response carries on the wire:
 * `{ error: "CODE", fields?: { field: "message" } }`.
 *
 * `error` holds the machine-readable code, never the human-readable message —
 * that is the contract MCP clients branch on. It is a plain `string` rather
 * than `ErrorCode` because a route may answer with a code of its own that
 * predates this list.
 */
export interface ErrorEnvelope {
    error: string;
    fields?: ErrorFields;
}
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
export declare class AppError extends Error {
    readonly status: number;
    readonly code: string;
    readonly fields?: ErrorFields;
    readonly expose: boolean;
    constructor(status: number, message: string, options?: AppErrorOptions);
}
/**
 * 400/422 — request body or params failed validation.
 *
 * Defaults to 422, which is what Core already returned from
 * `validationErrorFromZod`. **The extension backends answer 400** and pass
 * `{ status: 400 }` explicitly at every call site — their clients branch on it.
 * Take the default only if you mean Core's status.
 */
export declare class ValidationError extends AppError {
    constructor(message?: string, options?: AppErrorOptions & {
        status?: number;
    });
}
/** 401 — no valid credentials were presented. */
export declare class AuthError extends AppError {
    constructor(message?: string, options?: AppErrorOptions);
}
/**
 * 403 — authenticated, but not allowed.
 *
 * Distinct from `AuthError` because the two drive different client behaviour:
 * a 401 sends the user to log in, a 403 must not. The apps already made this
 * distinction by hand (ai-tutor alone had 18 "Not authorized for this course"
 * responses), so collapsing them into one class would lose information.
 */
export declare class ForbiddenError extends AppError {
    constructor(message?: string, options?: AppErrorOptions);
}
/** 404 — the addressed resource does not exist or is not visible to the caller. */
export declare class NotFoundError extends AppError {
    constructor(message?: string, options?: AppErrorOptions);
}
/** 409 — the request conflicts with existing state (uniqueness, concurrent edit). */
export declare class ConflictError extends AppError {
    constructor(message?: string, options?: AppErrorOptions);
}
/**
 * 503 — a dependency (queue, database, upstream service) is unavailable.
 *
 * Core's `QueueUnavailableError` is the original of this; it now extends this
 * class while keeping its own literal `status`/`code` so the #1112 contract
 * ("routes must map this to 503 — never 400") is unchanged.
 */
export declare class ServiceUnavailableError extends AppError {
    constructor(message?: string, options?: AppErrorOptions);
}
/** True when `error` is an `AppError` from any copy of this module. */
export declare function isAppError(error: unknown): error is AppError;
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
/**
 * Reduce any thrown value to the status, code and client-safe message a route
 * boundary should return.
 *
 * Recognises `AppError`, Zod errors, Prisma known-request errors, and the
 * `err.status`/`err.statusCode` convention used by Express and by the apps'
 * existing hand-rolled errors. Everything else becomes a generic 500 — this is
 * what stops raw internal text from reaching clients.
 */
export declare function normalizeError(error: unknown): NormalizedError;
//# sourceMappingURL=errors.d.ts.map