/**
 * Express error-handling middleware that converts thrown errors into structured JSON responses.
 * Provides a 404 generator for unknown routes and a centralized formatter/logger for unexpected failures.
 */
import { Prisma } from "@eduai/question-maker-prisma-client";
import { logger } from "../utils/logger.js";
import { PaginationError } from "../utils/pagination.js";
import { safeRequestLogFields } from "../utils/safeLogging.js";

/** Creates a 404 error for unmatched routes so the main handler can respond consistently. */
export const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.status = 404;
  next(error);
};

/**
 * Logs the error with context and responds with sanitized JSON, mapping common
 * token/validation issues to user-friendly messages. Error messages, request
 * objects, response bodies, and stacks are deliberately excluded from both
 * logs and responses: provider/DB errors frequently contain credentials or
 * SQL/request payloads even outside production.
 */
export const errorHandler = (err, req, res, next) => {
  let error = { status: err?.status ?? err?.statusCode };

  // Map known classes before logging so the status/code metadata is stable.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const fields = Array.isArray(err.meta?.target) ? err.meta.target : [];
      const message = fields.length
        ? `A record with this ${fields.join(", ")} already exists`
        : "Resource already exists";
      error = { message, status: 409, code: "RESOURCE_EXISTS" };
    } else if (err.code === "P2003") {
      error = {
        message: "Referenced resource does not exist",
        status: 400,
        code: "RESOURCE_REFERENCE_INVALID",
      };
    } else if (err.code === "P2025") {
      error = { message: "Resource not found", status: 404, code: "RESOURCE_NOT_FOUND" };
    }
  }

  // JWT errors
  if (err?.name === "JsonWebTokenError") {
    error = { message: "Invalid token", status: 401, code: "AUTH_INVALID_TOKEN" };
  }

  if (err?.name === "TokenExpiredError") {
    error = { message: "Token expired", status: 401, code: "AUTH_TOKEN_EXPIRED" };
  }

  const safeCode = [
    error?.code,
    err?.body?.error,
    err?.reasonCode,
    err instanceof PaginationError ? err.code : null,
    err?.code,
  ].find(
    (candidate) =>
      typeof candidate === "string" &&
      /^[A-Z][A-Z0-9_]{1,63}$/.test(candidate) &&
      /^(?:QM_|PAGINATION_|CORE_|COURSE_|EDUAI_|AUTH_|CSRF_|RESOURCE_|VARIANT_|QUESTION_|ASSESSMENT_|INVALID_|DUPLICATE_|BUG_|PROVIDER_)/.test(
        candidate,
      ),
  );

  const status = Number.isInteger(error.status) ? error.status : 500;
  const isStableUpstream = err?.isSanitizedUpstreamError === true;
  const hasExplicitPublicStatus =
    err?.isPublic === true || err?.name === "PaginationError" || Boolean(safeCode);
  const message =
    error.message ||
    (isStableUpstream || err?.isPublic === true || hasExplicitPublicStatus ? err?.message : null);
  const publicMessage =
    message &&
    (isStableUpstream ||
      error.code?.startsWith?.("RESOURCE_") ||
      error.code?.startsWith?.("AUTH_") ||
      hasExplicitPublicStatus)
      ? message
      : status === 404
        ? "Not Found"
        : "Request failed";

  // Log only allowlisted transport/status metadata. Never pass the Error
  // object or its message as structured data/serialised log text.
  const logLevel = status >= 500 ? "error" : "warn";
  logger[logLevel](
    {
      ...safeRequestLogFields({ ...err, status }),
      code: safeCode || undefined,
      req: {
        method: req.method,
        path: req.path,
      },
      status,
    },
    "Request error",
  );

  res.status(status).json({
    success: false,
    error: publicMessage,
    // `PaginationError`'s code surfaces so clients can branch on it. Gated on
    // the error type rather than on `error.code` being present: transport
    // failures (`ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT` from the Core fetch
    // paths) also carry `code`, and leaking those would both expose internal
    // infrastructure detail and clobber the semantic `body.error` code below.
    // JSON.stringify drops the undefined, so ungated errors send no `code`.
    code: safeCode || undefined,
  });
};
