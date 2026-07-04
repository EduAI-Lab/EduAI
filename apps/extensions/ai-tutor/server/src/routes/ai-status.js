import express from 'express';

const router = express.Router();

const CORE_URL = process.env.CORE_URL || 'http://localhost:3000';
const UNKNOWN = { state: 'unknown', detail: 'Status unavailable.' };

/**
 * Dual AI-service status for the header chips (issue #764). AI Tutor delegates AI
 * to EduAI Core, so this proxies Core's independent /api/ai-status probe,
 * forwarding the user's session cookie. Each service (cloud / UBC-hosted) is
 * reported on its own. Falls back to "unknown" if Core can't be reached, so the
 * header never breaks.
 */
router.get('/ai-status', async (req, res) => {
  try {
    const upstream = await fetch(`${CORE_URL}/api/ai-status`, {
      headers: { cookie: req.headers.cookie ?? '' },
    });
    if (!upstream.ok) {
      return res.json({ cloud: UNKNOWN, ubc: UNKNOWN });
    }
    const data = await upstream.json();
    return res.json(data);
  } catch {
    return res.json({ cloud: UNKNOWN, ubc: UNKNOWN });
  }
});

export default router;
