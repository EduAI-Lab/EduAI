import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config/settings.js';

const router = express.Router();

const BUG_REPORT_ADMIN_ROLES = new Set(['ADMIN', 'UNIT_ADMIN']);

router.get('/auth/me', requireAuth, (req, res) => {
  const isBugReportAdmin =
    BUG_REPORT_ADMIN_ROLES.has(req.user.role) ||
    config.bugReportAdminEmails.includes(req.user.email);

  res.json({ user: { ...req.user, isBugReportAdmin } });
});

// Proxy sign-out to Core server-to-server, avoiding browser CORS restrictions.
// No requireAuth — signing out an invalid session is a no-op, not an error.
router.post('/auth/logout', async (req, res) => {
  try {
    await fetch(`${config.coreUrl}/api/auth/sign-out`, {
      method: 'POST',
      headers: { cookie: req.headers.cookie ?? '' },
    });
  } catch {
    // Best-effort — proceed even if Core is unreachable.
  }
  res.json({ ok: true });
});

export default router;
