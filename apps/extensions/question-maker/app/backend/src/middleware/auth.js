/**
 * Session validation and RBAC middleware for Question Maker API routes.
 *
 * Validates the incoming session cookie via Core's POST /api/sessions/validate,
 * ensures a local user row exists for FK integrity (creating it on first login),
 * and populates `req.user` with the Core user shape.
 */
import { findOrCreateUser } from '../services/authService.js';

const VALID_ROLES = new Set(['STUDENT', 'INSTRUCTOR', 'TA', 'ADMIN', 'UNIT_ADMIN']);

function normalizeRole(role) {
  return VALID_ROLES.has(role) ? role : 'STUDENT';
}

/**
 * Validate the request's session cookie against Core and populate `req.user`.
 * API routes (path starts with /api/) return 401 on failure; other routes
 * redirect to Core login with a ?redirect= param so the user lands back here.
 */
export async function requireAuth(req, res, next) {
  try {
    const response = await fetch(`${process.env.CORE_URL}/api/sessions/validate`, {
      method: 'POST',
      headers: { cookie: req.headers.cookie ?? '' },
    });

    if (!response.ok) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const { user: coreUser } = await response.json();
    const normalizedUser = { ...coreUser, role: normalizeRole(coreUser.role) };
    await findOrCreateUser(normalizedUser);
    req.user = normalizedUser;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Authentication required' });
  }
}

/**
 * Build a middleware that requires the caller's role to be in `allowed`.
 * Pass a single role string or an array.
 */
export function requireRole(allowed) {
  const roles = Array.isArray(allowed) ? allowed : [allowed];
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `One of the following roles required: ${roles.join(', ')}`,
      });
    }
    next();
  };
}

// Backward-compat alias: existing route files import authenticateToken.
export { requireAuth as authenticateToken };
