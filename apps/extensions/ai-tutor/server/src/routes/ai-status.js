import express from "express";

const router = express.Router();

const CORE_URL = process.env.CORE_URL || "http://localhost:3000";
const UNKNOWN = { state: "unknown", detail: "Status unavailable." };
// With no live probe behind either endpoint (see below), we can't say when the
// data was last checked or vouch for its freshness — surface that honestly
// rather than let a silent gap read as "fine".
const UNKNOWN_STATUS = { cloud: UNKNOWN, ubc: UNKNOWN, checkedAt: null, stale: true };

/**
 * Dual AI-service status for the header chips (issue #764). AI Tutor delegates AI
 * to EduAI Core, so this proxies Core's independent /api/ai-status endpoint,
 * forwarding the user's session cookie. Each service (cloud / UBC-hosted) is
 * reported on its own. Falls back to "unknown" if Core can't be reached, so the
 * header never breaks.
 */
router.get("/ai-status", async (req, res) => {
  try {
    const upstream = await fetch(`${CORE_URL}/api/ai-status`, {
      headers: { cookie: req.headers.cookie ?? "" },
      // Core now serves this from a database snapshot (two indexed reads, no
      // live probe — Task 8 replaced the fleet probe with a cron-populated
      // table), so a couple of seconds is ample; anything slower means Core
      // itself is unhealthy and we should fall back to UNKNOWN quickly rather
      // than let a hung request pile up sockets.
      signal: AbortSignal.timeout(2000),
    });
    if (!upstream.ok) {
      return res.json(UNKNOWN_STATUS);
    }
    const data = await upstream.json();
    return res.json(data);
  } catch {
    return res.json(UNKNOWN_STATUS);
  }
});

/**
 * 72-hour AI-service history for the UBC chip's history panel (issue #764
 * follow-on). Proxies Core's /api/ai-status/history, forwarding the user's
 * session cookie, so the panel reads the same persisted sample table Core's
 * own header does. Falls back to an error response if Core can't be reached;
 * unlike /ai-status this has no "unknown" shape to degrade to since the panel
 * itself handles a missing payload.
 */
router.get("/ai-status/history", async (req, res) => {
  try {
    const upstream = await fetch(`${CORE_URL}/api/ai-status/history?hours=72`, {
      headers: { cookie: req.headers.cookie ?? "" },
      // Same reasoning as /ai-status above: a DB read, not a live probe.
      signal: AbortSignal.timeout(2000),
    });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: "Upstream status history unavailable" });
    }
    const data = await upstream.json();
    return res.json(data);
  } catch {
    return res.status(502).json({ error: "Upstream status history unreachable" });
  }
});

export default router;
