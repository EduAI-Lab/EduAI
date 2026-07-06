/**
 * Service-key authentication for server-to-server calls *into* AI Tutor
 * (currently: Core pushing cascade-delete on course removal, §802).
 * Mirrors Core's own `requireServiceKey` guard (apps/core/app/lib/auth/guards.server.ts).
 */
import { timingSafeEqual, createHash } from 'crypto';

/**
 * Requires `Authorization: Bearer <EDUAI_API_KEY>`.
 * 401 when the header is missing, 403 when the token does not match.
 */
export function requireServiceKey(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'MISSING_SERVICE_KEY' });
  }

  const token = authHeader.slice(7);
  const envKey = process.env.EDUAI_API_KEY;

  if (!envKey) {
    return res.status(403).json({ error: 'INVALID_SERVICE_KEY' });
  }

  // Hash both sides to a fixed length so timingSafeEqual never throws on length
  // mismatch (which would itself leak timing information).
  const tokenHash = createHash('sha256').update(token).digest();
  const keyHash = createHash('sha256').update(envKey).digest();

  if (!timingSafeEqual(tokenHash, keyHash)) {
    return res.status(403).json({ error: 'INVALID_SERVICE_KEY' });
  }

  next();
}
