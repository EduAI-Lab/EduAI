import express from "express";

const router = express.Router();

const CORE_URL = process.env.CORE_URL || "http://localhost:3000";
const UNKNOWN = { state: "unknown", detail: "Status unavailable." };

/**
 * Dual AI-service status for the header chips (issue #764). AI Tutor delegates AI
 * to EduAI Core, so this proxies Core's independent /api/ai-status probe,
 * forwarding the user's session cookie. Each service (cloud / UBC-hosted) is
 * reported on its own. Falls back to "unknown" if Core can't be reached, so the
 * header never breaks.
 */
router.get("/ai-status", async (req, res) => {
  try {
    const upstream = await fetch(`${CORE_URL}/api/ai-status`, {
      headers: { cookie: req.headers.cookie ?? "" },
      // Must outlast Core's own worst-case probe, else we abort mid-probe and
      // report UNKNOWN in exactly the degraded/outage cases the chips exist to
      // surface. Core fleet-probes each host with a 5s health timeout (#1551),
      // and its 30s status cache is shorter than this 60s poll, so most polls
      // hit a cold cache and pay the live probe. Bound at 7s (5s health + slack)
      // so a genuinely hung Core still can't pile up sockets; abort → UNKNOWN.
      signal: AbortSignal.timeout(7000),
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
