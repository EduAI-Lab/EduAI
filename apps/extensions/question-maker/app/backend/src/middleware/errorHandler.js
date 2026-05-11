/**
 * Express error-handling middleware that converts thrown errors into structured JSON responses.
 * Provides a 404 generator for unknown routes and a centralized formatter/logger for unexpected failures.
 */
import { logger } from '../utils/logger.js';

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

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = { message, status: 404 };
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const message = 'Duplicate field value entered';
    error = { message, status: 400 };
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message);
    error = { message, status: 400 };
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
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};
