import express from 'express';
import { toPublicUser } from '../utils/mappers.js';
import { listEduAiCourses } from '../services/eduaiClient.js';
import {
  runCoreMirror,
  resetCoreMirrorThrottleForTests,
  userHasCoreTaEnrollment,
} from '../services/importTaughtCoursesService.js';

const router = express.Router();

// The Core course mirror is a throttled fire-and-forget background side
// effect shared by every route that triggers it (`runCoreMirror` in
// importTaughtCoursesService — the unified contract's single mirror entry
// point). `/api/me` runs on every client navigation, so it must never await
// the mirror's Core-fetch + DB-write waterfall.
export { resetCoreMirrorThrottleForTests };

router.get('/me', async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: 'Authentication required' });

  const cookie = req.headers.cookie ?? '';
  let coreCourses;

  try {
    // #1041: paged upstream; this flow reconciles against the caller's full set.
    coreCourses = await listEduAiCourses({ cookie, all: true });
  } catch (err) {
    console.error('[eduai] Core course list failed on /me', err);
    coreCourses = null;
  }

  const sharedOptions = coreCourses != null ? { coreCourses } : {};

  // Fire-and-forget, throttled — does not block the /me response.
  runCoreMirror(authUser, cookie, sharedOptions);

  const publicUser = toPublicUser(authUser);
  let effectiveUser = publicUser;

  if (publicUser && publicUser.role === 'STUDENT' && coreCourses != null) {
    try {
      if (await userHasCoreTaEnrollment(cookie, coreCourses)) {
        effectiveUser = { ...publicUser, role: 'TA' };
      }
    } catch (err) {
      console.error('[eduai] Effective TA role resolution failed on /me', err);
    }
  }

  res.json({ user: effectiveUser });
});

// Proxy sign-out to Core server-to-server, avoiding browser CORS restrictions.
// No requireAuth — signing out an invalid session is a no-op, not an error.
router.post('/logout', async (req, res) => {
  const coreUrl = process.env.CORE_URL || 'http://localhost:3000';
  const corePublicOrigin = process.env.CORE_PUBLIC_ORIGIN || coreUrl;
  try {
    const coreRes = await fetch(`${coreUrl}/api/auth/sign-out`, {
      method: 'POST',
      headers: {
        cookie: req.headers.cookie ?? '',
        origin: corePublicOrigin,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    if (!coreRes.ok) {
      console.error('[ai-tutor] Core sign-out failed', coreRes.status);
    }
  } catch (err) {
    console.error('[ai-tutor] Core sign-out request failed', err);
    // Proceed even if Core is unreachable
  }
  res.json({ ok: true });
});

export default router;
