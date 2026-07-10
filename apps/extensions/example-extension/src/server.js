/**
 * Example EduAI Extension
 *
 * A minimal Express server that demonstrates the Core auth integration pattern.
 * No database, no framework — just the three things every extension needs:
 *   1. Session validation via POST /api/sessions/validate on Core
 *   2. Login redirect for browser routes
 *   3. User-scoped and service-level calls to Core APIs
 *
 * See docs/EXTENSION_ONBOARDING.md for the full guide.
 * Run: cp .env.example .env && npm install && npm run dev
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { requireAuth, requireRole } from './middleware/auth.js';

const app = express();
const PORT = process.env.PORT || 9000;
const CORE_URL = process.env.CORE_URL || 'http://localhost:3000';
const EDUAI_BASE_URL = process.env.EDUAI_BASE_URL || `${CORE_URL}/api`;

app.use(
  cors({
    origin: process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  }),
);
app.use(express.json());

// ── Unauthenticated ──────────────────────────────────────────────────────────

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', extension: 'example-extension' });
});

// ── Browser route: home page ─────────────────────────────────────────────────
// requireAuth redirects unauthenticated browsers to Core login and returns
// them here after a successful login (via the ?redirect= param).

app.get('/', requireAuth, (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Example Extension</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 60px auto; padding: 0 20px; }
    pre  { background: #f4f4f4; padding: 16px; border-radius: 6px; font-size: 13px; }
    h2   { color: #555; font-weight: normal; }
  </style>
</head>
<body>
  <h1>Example Extension ✓</h1>
  <h2>Logged in as <strong>${req.user.name}</strong> (${req.user.email})</h2>
  <p>Role: <code>${req.user.role}</code></p>
  <pre>${JSON.stringify(req.user, null, 2)}</pre>
  <hr>
  <p>Try these endpoints:</p>
  <ul>
    <li><a href="/api/me">GET /api/me</a> — current user (JSON)</li>
    <li><a href="/api/courses">GET /api/courses</a> — courses from Core (forwarded cookie)</li>
    <li><a href="/api/admin-only">GET /api/admin-only</a> — ADMIN / UNIT_ADMIN only</li>
    <li><a href="/healthz">GET /healthz</a> — unauthenticated health check</li>
  </ul>
</body>
</html>`);
});

// ── API routes ───────────────────────────────────────────────────────────────

// Returns the Core user identity — the minimal building block every extension
// uses to know who is making the request.
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Role-gated example: ADMIN or UNIT_ADMIN only.
app.get('/api/admin-only', requireAuth, requireRole(['ADMIN', 'UNIT_ADMIN']), (req, res) => {
  res.json({ message: 'You have admin access.', user: req.user });
});

// User-scoped Core API call: forward the browser's session cookie so Core
// applies the correct role filtering for this specific user.
app.get('/api/courses', requireAuth, async (req, res) => {
  try {
    const upstream = await fetch(`${EDUAI_BASE_URL}/courses`, {
      headers: { cookie: req.headers.cookie ?? '' },
    });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'Core returned an error', status: upstream.status });
    }
    res.json(await upstream.json());
  } catch {
    res.status(503).json({ error: 'Could not reach Core — is it running?' });
  }
});

// Service-level Core API call: no user context, use the shared API key.
// Uncomment and set EDUAI_API_KEY to test.
//
// app.get('/api/internal/example', requireAuth, requireRole(['ADMIN']), async (req, res) => {
//   const upstream = await fetch(`${EDUAI_BASE_URL}/some-admin-endpoint`, {
//     headers: { Authorization: `Bearer ${process.env.EDUAI_API_KEY}` },
//   });
//   res.json(await upstream.json());
// });

// ── Boot ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[example-extension] Running on http://localhost:${PORT}`);
  console.log(`[example-extension] Core: ${CORE_URL}`);
  console.log(`[example-extension] Open http://localhost:${PORT} in a browser to test the login flow`);
});
