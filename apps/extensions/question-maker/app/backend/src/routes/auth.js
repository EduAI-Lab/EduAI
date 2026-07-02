import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config/settings.js';
import { getMyProfileFromCore } from '../services/coreApiService.js';

const router = express.Router();

// §11: bug-report triage is ADMIN-only (role-based, replacing the prior email allowlist).
router.get('/auth/me', requireAuth, async (req, res, next) => {
  try {
    const isBugReportAdmin = req.user.role === 'ADMIN';
    let authorizedUnits;

    if (req.user.role === 'UNIT_ADMIN') {
      const profile = await getMyProfileFromCore(req.headers.cookie).catch(() => null);
      authorizedUnits = Array.isArray(profile?.authorizedUnits) ? profile.authorizedUnits : [];
    }

    res.json({
      user: {
        ...req.user,
        isBugReportAdmin,
        ...(authorizedUnits !== undefined ? { authorizedUnits } : {}),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Proxy sign-out to Core server-to-server, avoiding browser CORS restrictions.
// No requireAuth — signing out an invalid session is a no-op, not an error.
router.post('/auth/logout', async (req, res) => {
  try {
    const coreRes = await fetch(`${config.coreUrl}/api/auth/sign-out`, {
      method: 'POST',
      headers: {
        cookie: req.headers.cookie ?? '',
        origin: config.corePublicOrigin,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    if (!coreRes.ok) {
      console.error('[question-maker] Core sign-out failed', coreRes.status);
    }
  } catch (err) {
    console.error('[question-maker] Core sign-out request failed', err);
    // Proceed even if Core is unreachable.
  }
  res.json({ ok: true });
});

export default router;
