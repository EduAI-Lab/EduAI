/**
 * Express error-handling middleware that converts thrown errors into structured JSON responses.
 * Provides a 404 generator for unknown routes and a centralized formatter/logger for unexpected failures.
 */
import { Prisma } from '../../generated/prisma/index.js';
import { logger } from '../utils/logger.js';
import { PaginationError } from '../utils/pagination.js';

/** Creates a 404 error for unmatched routes so the main handler can respond consistently. */
export const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.status = 404;
  next(error);
};

/**
 * Logs the error with context and responds with sanitized JSON, mapping common token/validation issues to user-friendly messages.
 * Includes stack traces only in development to avoid leaking internals in production.
 */
export const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error with structured logging
  const logLevel = error.status >= 500 ? 'error' : 'warn';
  logger[logLevel]({
    err: error,
    req: {
      method: req.method,
      url: req.url,
      path: req.path,
      query: req.query,
    },
    status: error.status || 500,
  }, error.message || 'Request error');

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      // Unique-constraint violation → 409 Conflict
      const fields = Array.isArray(err.meta?.target) ? err.meta.target : [];
      const message = fields.length
        ? `A record with this ${fields.join(', ')} already exists`
        : 'Resource already exists';
      error = { message, status: 409 };
    } else if (err.code === 'P2003') {
      // Foreign-key violation → 400 (references a missing record)
      error = { message: 'Referenced resource does not exist', status: 400 };
    } else if (err.code === 'P2025') {
      // Record required for the operation was not found → 404
      error = { message: 'Resource not found', status: 404 };
    }
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token';
    error = { message, status: 401 };
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired';
    error = { message, status: 401 };
  }

  res.status(error.status || 500).json({
    success: false,
    error: error.message || 'Server Error',
    // `PaginationError`'s code surfaces so clients can branch on it. Gated on
    // the error type rather than on `error.code` being present: transport
    // failures (`ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT` from the Core fetch
    // paths) also carry `code`, and leaking those would both expose internal
    // infrastructure detail and clobber the semantic `body.error` code below.
    ...(err instanceof PaginationError ? { code: err.code } : {}),
    ...(error.body?.error ? { code: error.body.error } : {}),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};
