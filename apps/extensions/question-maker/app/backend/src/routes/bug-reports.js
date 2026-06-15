import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config/settings.js';

const router = express.Router();

const STATUS_MAP = {
  unhandled: 'UNHANDLED',
  'in progress': 'IN_PROGRESS',
  resolved: 'RESOLVED',
};

/** Adapt Core's admin bug-report shape to the shape the QM frontend expects. */
function adaptReport(r) {
  return {
    id: r.id,
    description: r.description,
    // Core uses UPPER_SNAKE_CASE; frontend selects expect lowercase with spaces.
    status: (r.status ?? 'UNHANDLED').toLowerCase().replace('_', ' '),
    consoleLogs: r.consoleLogs ?? null,
    networkLogs: r.networkLogs ?? null,
    screenshot: r.screenshot ?? null,
    pageUrl: r.pageUrl ?? null,
    userAgent: r.userAgent ?? null,
    isAnonymous: r.isAnonymous ?? false,
    userId: r.userId ?? null,
    user: r.userEmail ? { email: r.userEmail } : null,
    createdAt: r.createdAt,
    source: r.source ?? null,
  };
}

/** GET /api/bug-reports — proxy to Core admin listing (ADMIN only). */
router.get('/bug-reports', requireAuth, async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ success: false, error: 'Admin role required' });
  }

  try {
    const response = await fetch(`${config.coreUrl}/api/admin/bug-reports`, {
      headers: { cookie: req.headers.cookie ?? '' },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return res.status(502).json({ success: false, error: body.error ?? 'Core request failed' });
    }

    const { reports } = await response.json();
    return res.json({ success: true, data: (reports ?? []).map(adaptReport) });
  } catch {
    return res.status(502).json({ success: false, error: 'Could not reach Core' });
  }
});

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

/** PATCH /api/bug-reports/:id — update status (ADMIN only). */
router.patch('/bug-reports/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ success: false, error: 'Admin role required' });
  }

  const { status } = req.body || {};
  const coreStatus = STATUS_MAP[status] ?? status?.toUpperCase().replace(' ', '_');

  try {
    const response = await fetch(
      `${config.coreUrl}/api/admin/bug-reports/${req.params.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          cookie: req.headers.cookie ?? '',
        },
        body: JSON.stringify({ status: coreStatus }),
      }
    );

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return res.status(502).json({ success: false, error: body.error ?? 'Core request failed' });
    }

    return res.json({ success: true });
  } catch {
    return res.status(502).json({ success: false, error: 'Could not reach Core' });
  }
});

export default router;
