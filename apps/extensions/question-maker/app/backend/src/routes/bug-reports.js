import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { config } from '../config/settings.js';

const router = express.Router();

/** POST /api/bug-reports — submit a bug report (any authenticated user). */
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

/** GET /api/admin/bug-reports — ADMIN-only proxy to Core triage API. */
router.get('/admin/bug-reports', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const url = new URL(`${config.coreUrl}/api/admin/bug-reports`);
    for (const [key, value] of Object.entries(req.query)) {
      if (value != null && value !== '') url.searchParams.set(key, String(value));
    }

    const response = await fetch(url.toString(), {
      headers: { cookie: req.headers.cookie ?? '' },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({ success: false, ...body });
    }
    return res.json({ success: true, data: body });
  } catch {
    return res.status(502).json({ success: false, error: 'Could not reach Core' });
  }
});

/**
 * GET /api/admin/bug-reports/:id — full detail including diagnostic blobs.
 * Core list responses omit console/network/screenshot (#979); the admin UI
 * loads attachments on demand through this proxy.
 */
router.get('/admin/bug-reports/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const response = await fetch(
      `${config.coreUrl}/api/admin/bug-reports/${encodeURIComponent(req.params.id)}`,
      {
        headers: { cookie: req.headers.cookie ?? '' },
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({ success: false, ...body });
    }
    // Scope QM triage to Question Maker reports (same filter as the list UI).
    if (body?.source && body.source !== 'QUESTION_MAKER') {
      return res.status(404).json({ success: false, error: 'Bug report not found' });
    }
    return res.json({ success: true, data: body });
  } catch {
    return res.status(502).json({ success: false, error: 'Could not reach Core' });
  }
});

/** PATCH /api/admin/bug-reports/:id — ADMIN-only status update via Core. */
router.patch('/admin/bug-reports/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const response = await fetch(
      `${config.coreUrl}/api/admin/bug-reports/${encodeURIComponent(req.params.id)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          cookie: req.headers.cookie ?? '',
        },
        body: JSON.stringify(req.body ?? {}),
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({ success: false, ...body });
    }
    return res.json({ success: true, data: body });
  } catch {
    return res.status(502).json({ success: false, error: 'Could not reach Core' });
  }
});

export default router;
