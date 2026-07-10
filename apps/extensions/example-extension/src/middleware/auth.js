/**
 * Session validation and RBAC middleware.
 * Copied verbatim from docs/EXTENSION_ONBOARDING.md §4-6.
 *
 * Every extension implements this same pattern — no OAuth, no local passwords.
 * Core is the single identity provider.
 */

const VALID_ROLES = new Set(['STUDENT', 'PROFESSOR', 'TA', 'ADMIN', 'UNIT_ADMIN']);

function normalizeRole(role) {
  return VALID_ROLES.has(role) ? role : 'STUDENT';
}

/**
 * Validate the request's session cookie against Core and populate `req.user`.
 *
 * API routes (/api/*) return 401 on failure so the caller can handle it.
 * All other routes redirect to Core login with ?redirect= so the user lands
 * back here after authenticating.
 */
export async function requireAuth(req, res, next) {
  try {
    const response = await fetch(
      `${process.env.CORE_URL || 'http://localhost:3000'}/api/sessions/validate`,
      {
        method: 'POST',
        headers: { cookie: req.headers.cookie ?? '' },
      },
    );

    if (!response.ok) {
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const returnUrl = encodeURIComponent(
        `${process.env.EXTENSION_URL || 'http://localhost:9000'}${req.originalUrl}`,
      );
      return res.redirect(
        `${process.env.CORE_URL || 'http://localhost:3000'}/login?redirect=${returnUrl}`,
      );
    }

    const { user } = await response.json();
    req.user = { ...user, role: normalizeRole(user.role) };
    next();
  } catch {
    res.status(503).json({ error: 'Auth service unavailable — is Core running?' });
  }
}

/**
 * Build a middleware that requires the caller's role to be in `allowed`.
 * Apply after requireAuth; the role is already normalized on req.user.
 *
 * Example: requireRole(['ADMIN', 'PROFESSOR'])
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
