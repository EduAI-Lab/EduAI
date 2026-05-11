/**
 * @file Session resolution and RBAC middleware for `/api/*` routes.
 *
 * Responsibility: Translate the Better Auth cookie session into a fully
 *   hydrated `req.user` object, then provide guards that gate handlers by
 *   authentication and role.
 * Callers: `server/src/app.js` chains these on every `/api/*` request.
 *   Individual route modules use `requireRole(s)` to scope handlers.
 * Gotchas:
 *   - `attachSession` re-fetches the User row from Postgres on every request
 *     instead of trusting the role embedded in the Better Auth session.
 *     Sessions are long-lived and an admin-driven role change must take
 *     effect immediately; trusting the cached role would let demoted users
 *     keep elevated access until cookie expiry.
 *   - `req.user` is the canonical identity for all downstream handlers. Do
 *     not fall back to `req.session` or re-call `auth.api.getSession`.
 *   - Errors from Better Auth are swallowed and treated as unauthenticated,
 *     so a transient auth provider failure surfaces as 401 rather than 500.
 * Related: `server/src/auth.js`, `server/src/app.js`.
 */

import { auth } from '../auth.js';
import { fromNodeHeaders } from 'better-auth/node';
import { prisma } from '../config/database.js';

/**
 * Populate `req.user` from the Better Auth cookie session.
 *
 * Why: Downstream handlers need the authoritative DB role, not whatever was
 *   serialized into the session at login time. Re-fetching also ensures
 *   deletions/role changes take effect on the next request.
 */
export async function attachSession(req, res, next) {
  try {
    const headers = fromNodeHeaders(req.headers);
    const data = await auth.api.getSession({ headers });
    if (data && data.user) {
      // Re-hydrate from DB so RBAC sees the current role even if the
      // session was issued before a role change.
      const dbUser = await prisma.user.findUnique({
        where: { id: data.user.id },
      });
      req.user = dbUser ?? null;
    } else {
      req.user = null;
    }
  } catch {
    // Treat any auth-resolution failure as unauthenticated rather than
    // bubbling a 500. The next middleware will return 401 if needed.
    req.user = null;
  }
  next();
}

/**
 * Reject anonymous requests with 401.
 *
 * Use as the baseline gate for any handler that requires a signed-in user
 * but does not care about role.
 */
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

/**
 * Build a guard that requires exactly one specific role.
 *
 * Why: For handlers that target a single persona (e.g. ADMIN-only system
 *   settings). For multi-role handlers, use `requireRoles` instead — chaining
 *   multiple `requireRole` calls would AND them, which is never what you want.
 */
export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (req.user.role !== role) {
      return res.status(403).json({ error: `${role} role required` });
    }

    next();
  };
}

/**
 * Build a guard that requires the caller's role to be in `roles`.
 *
 * Use when a handler serves multiple personas (e.g. PROFESSOR + TA both
 * manage course content).
 */
export function requireRoles(roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: `One of the following roles required: ${roles.join(', ')}` });
    }

    next();
  };
}
