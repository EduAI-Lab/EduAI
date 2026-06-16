import express from 'express';
import { toPublicUser } from '../utils/mappers.js';
import { importTaughtCoursesFromCore } from '../services/importTaughtCoursesService.js';

const router = express.Router();

router.get('/me', async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: 'Authentication required' });

  try {
    await importTaughtCoursesFromCore(authUser, req.headers.cookie ?? '');
  } catch (err) {
    console.error('[eduai] Auto-import taught courses failed on login', err);
  }

  res.json({ user: toPublicUser(authUser) });
});

// Proxy sign-out to Core server-to-server, avoiding browser CORS restrictions.
// No requireAuth — signing out an invalid session is a no-op, not an error.
router.post('/logout', async (req, res) => {
  const coreUrl = process.env.CORE_URL || 'http://localhost:3000';
  try {
    await fetch(`${coreUrl}/api/auth/sign-out`, {
      method: 'POST',
      headers: { cookie: req.headers.cookie ?? '' },
    });
  } catch {
    // Best-effort — proceed even if Core is unreachable.
  }
  res.json({ ok: true });
});

export default router;
