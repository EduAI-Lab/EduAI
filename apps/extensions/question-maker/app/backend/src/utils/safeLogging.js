const SAFE_TRANSPORT_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'ERR_BAD_REQUEST',
  'ERR_BAD_RESPONSE',
  'ERR_CANCELED',
  'ERR_NETWORK',
]);

const CORRELATION_HEADERS = [
  'x-request-id',
  'x-correlation-id',
  'traceparent',
];

function safeInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max
    ? number
    : null;
}

function readHeader(headers, name) {
  if (!headers) return null;

  if (typeof headers.get === 'function') {
    const value = headers.get(name);
    return value == null ? null : String(value);
  }

  if (typeof headers !== 'object') return null;
  const key = Object.keys(headers).find(
    (candidate) => candidate.toLowerCase() === name,
  );
  const value = key ? headers[key] : null;
  return value == null ? null : String(value);
}

export function safeStatusCode(source) {
  return safeInteger(
    source?.statusCode ?? source?.response?.status ?? source?.status,
    { min: 100, max: 599 },
  );
}

export function safeTransportCode(source) {
  const candidate = source?.transportCode ?? source?.code;
  const code = typeof candidate === 'string' ? candidate.toUpperCase() : '';
  return SAFE_TRANSPORT_CODES.has(code) ? code : null;
}

export function safeCorrelationId(source) {
  const directValue = typeof source?.correlationId === 'string'
    ? source.correlationId.trim()
    : null;
  if (directValue && /^[a-zA-Z0-9._:/=-]{1,128}$/.test(directValue)) {
    return directValue;
  }

  const headers = source?.response?.headers ?? source?.headers;
  for (const name of CORRELATION_HEADERS) {
    const value = readHeader(headers, name)?.trim();
    if (value && /^[a-zA-Z0-9._:/=-]{1,128}$/.test(value)) {
      return value;
    }
  }
  return null;
}

/**
 * Builds log metadata from an explicit allowlist. Never serializes Axios
 * requests/configs, response bodies/headers, or arbitrary error messages.
 */
export function safeRequestLogFields(
  source,
  { elapsedMs, timeoutMs, count, attemptCount } = {},
) {
  const fields = {};
  const status = safeStatusCode(source);
  const code = safeTransportCode(source);
  const correlationId = safeCorrelationId(source);
  const safeElapsedMs = safeInteger(elapsedMs);
  const safeTimeoutMs = safeInteger(timeoutMs ?? source?.config?.timeout);
  const safeCount = safeInteger(count);
  const safeAttemptCount = safeInteger(attemptCount, { min: 1 });

  if (status !== null) fields.status = status;
  if (code) fields.code = code;
  if (safeElapsedMs !== null) fields.elapsedMs = safeElapsedMs;
  if (safeTimeoutMs !== null) fields.timeoutMs = safeTimeoutMs;
  if (safeCount !== null) fields.count = safeCount;
  if (safeAttemptCount !== null) fields.attemptCount = safeAttemptCount;
  if (correlationId) fields.correlationId = correlationId;

  return fields;
}

function isProviderCredentialFailure(error) {
  const body = error?.response?.data;
  const detail = body?.error ?? body?.message;
  return typeof detail === 'string' && /(?:invalid|missing).{0,30}api key|api key.{0,30}provider/i.test(detail);
}

/** Returns a stable, body-free error suitable for logs and HTTP responses. */
export function toStableUpstreamError(error, { serviceName = 'EduAI API' } = {}) {
  if (error?.isSanitizedUpstreamError === true) return error;

  const statusCode = safeStatusCode(error);
  const transportCode = safeTransportCode(error);
  let message = `${serviceName} error`;

  if (statusCode !== null) {
    message = `${serviceName} error (${statusCode})`;
  } else if (transportCode === 'ECONNABORTED' || transportCode === 'ETIMEDOUT') {
    message = `${serviceName} request timed out`;
  } else if (
    transportCode === 'ECONNREFUSED' ||
    transportCode === 'ENETUNREACH' ||
    transportCode === 'ENOTFOUND'
  ) {
    message = `${serviceName} server is unreachable`;
  } else if (transportCode === 'ECONNRESET') {
    message = `${serviceName} connection was reset`;
  } else if (transportCode) {
    message = `${serviceName} request failed (${transportCode})`;
  } else if (error?.request) {
    message = `${serviceName} request failed`;
  }

  const stableError = new Error(message);
  stableError.name = 'UpstreamServiceError';
  stableError.isSanitizedUpstreamError = true;
  if (statusCode !== null) stableError.statusCode = statusCode;
  if (transportCode) stableError.transportCode = transportCode;
  if (isProviderCredentialFailure(error)) {
    stableError.reasonCode = 'PROVIDER_API_KEY_REQUIRED';
  }
  const correlationId = safeCorrelationId(error);
  if (correlationId) stableError.correlationId = correlationId;
  return stableError;
}
