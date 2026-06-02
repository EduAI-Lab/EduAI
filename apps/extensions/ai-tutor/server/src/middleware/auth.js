/**
 * @file Session validation and RBAC middleware for `/api/*` routes.
 *
 * Validates the incoming session cookie by calling Core's
 * `POST /api/sessions/validate` endpoint and populates `req.user`.
 */

const VALID_ROLES = new Set(['STUDENT', 'INSTRUCTOR', 'TA', 'ADMIN', 'UNIT_ADMIN']);

function normalizeRole(role) {
  return VALID_ROLES.has(role) ? role : 'STUDENT';
}

/**
 * Validate the request's session cookie against Core and populate `req.user`.
 * Returns 401 if the cookie is absent, expired, or invalid.
 * `req.user` is set to `{ id, email, name, image, role }` on success.
 */
export async function requireAuth(req, res, next) {
  try {
    const response = await fetch(`${process.env.CORE_URL}/api/sessions/validate`, {
      method: 'POST',
      headers: { cookie: req.headers.cookie ?? '' },
    });

    if (!response.ok) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { user } = await response.json();
    req.user = { ...user, role: normalizeRole(user.role) };
    next();
  } catch {
    res.status(401).json({ error: 'Authentication required' });
  }
}

/**
 * Build a middleware that requires the caller's role to be in `allowed`.
 * Pass a single role string or an array.
 *
 * Example: requireRole(['ADMIN', 'INSTRUCTOR'])
 *          requireRole('INSTRUCTOR')
 */
export function requireRole(allowed) {
  const roles = Array.isArray(allowed) ? allowed : [allowed];
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

export const requireRoles = requireRole;
