import express from 'express';
import {
  fetchCoreAuthForRequest,
  isCoreAuthTimeoutError,
  requireAuth,
} from '../middleware/auth.js';
import { config } from '../config/settings.js';
import { getMyProfileFromCore } from '../services/coreApiService.js';

const router = express.Router();

// §11: bug-report triage is ADMIN-only (role-based, replacing the prior email allowlist).
router.get("/auth/me", requireAuth, async (req, res, next) => {
  try {
    const isBugReportAdmin = req.user.role === "ADMIN";
    let authorizedUnits;

    if (req.user.role === "UNIT_ADMIN") {
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
// No requireAuth — Core remains the authority on whether the forwarded session
// can be invalidated. Only acknowledge logout after Core confirms success.
router.post('/auth/logout', async (req, res) => {
  try {
    const coreRes = await fetchCoreAuthForRequest(req, `${config.coreUrl}/api/auth/sign-out`, {
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
      if (coreRes.status === 408 || coreRes.status === 504) {
        return res.status(504).json({ ok: false, error: 'Logout service timed out' });
      }
      if (coreRes.status === 429) {
        const retryAfter = coreRes.headers?.get?.('retry-after') ?? null;
        if (retryAfter !== null) res.set('Retry-After', retryAfter);
        return res.status(429).json({ ok: false, error: 'Logout rate limited', retryAfter });
      }
      return res.status(503).json({ ok: false, error: 'Logout service unavailable' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[question-maker] Core sign-out request failed', err);
    if (isCoreAuthTimeoutError(err)) {
      return res.status(504).json({ ok: false, error: 'Logout service timed out' });
    }
    return res.status(503).json({ ok: false, error: 'Logout service unavailable' });
  }
});

export default router;
