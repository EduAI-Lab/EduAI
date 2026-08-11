import { config } from '../config/settings.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim() === '*') return null;
  try {
    const origin = new URL(value.trim()).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

export function trustedOrigins(settings = config) {
  const configured = Array.isArray(settings.corsOrigins)
    ? settings.corsOrigins
    : typeof settings.corsOrigins === 'string'
      ? settings.corsOrigins.split(',')
      : [];
  return new Set(
    [
      ...configured,
      settings.corePublicOrigin,
      settings.extensionUrl,
    ]
      .map(normalizeOrigin)
      .filter(Boolean),
  );
}

/**
 * Reject unsafe cookie-authenticated requests from an untrusted browser
 * origin. Missing Origin remains compatible with server/non-browser clients;
 * an explicit Fetch Metadata cross-site signal is still rejected.
 */
export function csrfOriginGuard(req, res, next) {
  const method = typeof req.method === 'string' ? req.method.toUpperCase() : '';
  if (!UNSAFE_METHODS.has(method) || !req.headers.cookie) return next();

  const origin = req.headers.origin;
  const site = req.headers['sec-fetch-site'];
  const trusted = trustedOrigins();
  const originDenied = origin !== undefined && !trusted.has(normalizeOrigin(origin));
  const fetchMetadataDenied = !origin && typeof site === 'string' && site.toLowerCase() === 'cross-site';

  if (originDenied || fetchMetadataDenied) {
    return res.status(403).json({
      success: false,
      error: 'Cross-site request blocked',
      code: 'CSRF_ORIGIN_DENIED',
    });
  }

  return next();
}

export default csrfOriginGuard;
