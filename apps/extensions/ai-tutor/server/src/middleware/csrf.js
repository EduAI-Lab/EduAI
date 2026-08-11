import { corsOriginCallback } from '../config/cors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isTrustedOrigin(origin) {
  let trusted = false;
  corsOriginCallback(origin, (error, allowed) => {
    trusted = !error && allowed !== false;
  });
  return trusted;
}

/** Reject browser cross-origin cookie-authenticated mutations before routes. */
export function requireSameOriginMutation(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.headers.cookie) return next();
  // Explicit bearer/service authentication is not ambient browser authority.
  if (req.headers.authorization) return next();

  const origin = req.headers.origin;
  if (!origin) return next();
  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    .trim();
  const protocol = forwardedProto || req.protocol;
  const requestOrigin = `${protocol}://${req.get('host')}`;
  if (origin === requestOrigin || isTrustedOrigin(origin)) return next();

  return res.status(403).json({ error: 'Cross-origin request blocked' });
}
