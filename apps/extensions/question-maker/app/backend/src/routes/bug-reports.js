import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config/settings.js';

const router = express.Router();

/** POST /api/bug-reports — submit a bug report (any authenticated user). Triage: Core /admin/bug-reports. */
router.post('/bug-reports', requireAuth, async (req, res) => {
  const serviceKey = config.eduaiApiKey;
  if (!serviceKey) {
    return res.status(503).json({ success: false, error: 'Service key not configured' });
  }

  const { description, isAnonymous, consoleLogs, networkLogs, screenshot, pageUrl, userAgent } =
    req.body || {};

  const body = {
    source: 'QUESTION_MAKER',
    userId: req.user.id,
    description,
    isAnonymous: isAnonymous ?? false,
    consoleLogs: consoleLogs ?? null,
    networkLogs: networkLogs ?? null,
    screenshot: screenshot ?? null,
    pageUrl: pageUrl ?? null,
    userAgent: userAgent ?? null,
  };

  try {
    const response = await fetch(`${config.coreUrl}/api/bug-reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      if (response.status === 422) {
        return res.status(422).json({ success: false, ...errorBody });
      }
      return res.status(502).json({ success: false, error: 'Core request failed' });
    }

    return res.status(201).json({ success: true });
  } catch {
    return res.status(502).json({ success: false, error: 'Could not reach Core' });
  }
});

export default router;
