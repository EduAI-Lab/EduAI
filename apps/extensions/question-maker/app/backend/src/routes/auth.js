import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config/settings.js';
import { importTaughtCoursesFromCore } from '../services/importTaughtCoursesService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// §11: bug-report triage is ADMIN-only (role-based, replacing the prior email allowlist).
router.get('/auth/me', requireAuth, async (req, res) => {
  try {
    await importTaughtCoursesFromCore(
      req.user.id,
      req.user.role,
      req.headers.cookie ?? '',
    );
  } catch (err) {
    logger.warn({ err, userId: req.user.id }, 'Auto-import taught courses failed on login');
  }

  const isBugReportAdmin = req.user.role === 'ADMIN';

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
