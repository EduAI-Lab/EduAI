/**
 * Error-boundary helpers for HTTP routes.
 *
 * Unexpected errors can contain database URLs, provider responses, query text,
 * credentials, or stack paths.  Route boundaries must preserve the status
 * contract while replacing those details with a stable public message.  The
 * logger deliberately receives only a tiny allowlist as well; passing an Error
 * object to console would serialize its message/stack in several transports.
 */

function safeStatus(value) {
  return Number.isInteger(value) && value >= 400 && value <= 599 ? value : null;
}

/**
 * Keep only status metadata that is intentionally useful to diagnostics.
 * Error messages, codes, stacks, causes, response bodies, URLs, and arbitrary
 * fields are never copied.
 */
export function getSafeErrorMetadata(error) {
  const metadata = {};
  const status = safeStatus(error?.status);

  if (status !== null) metadata.status = status;
  return metadata;
}

/**
 * Log a route failure without passing the thrown value to the logger.
 * Returning the metadata makes the helper straightforward to assert in tests.
 */
export function logSafeError(message, error) {
  const metadata = getSafeErrorMetadata(error);
  console.error(message, metadata);
  return metadata;
}

/**
 * Send a stable route error while retaining an intentional HTTP status. An
 * optional response code is caller-supplied only when it is already a public
 * contract value; thrown error codes are never copied.
 * Callers that already validated a public error (for example PaginationError)
 * can continue to send that public message directly; unexpected catches should
 * use this helper instead.
 */
export function sendSafeError(res, error, fallbackMessage = "Internal server error", options = {}) {
  // Keep the error argument in the API so callers cannot accidentally pass
  // the thrown value into `res.json`; only allowlisted options are serialized.
  void error;
  // Generic route catches historically returned 500 even when an upstream
  // Error happened to carry a status.  Callers that intentionally preserve a
  // mapped status pass it explicitly via `options.status`.
  const status = safeStatus(options.status) ?? 500;
  const body = { error: fallbackMessage };
  const code = typeof options.code === "string" ? options.code : null;

  if (code) body.code = code;
  return res.status(status).json(body);
}
