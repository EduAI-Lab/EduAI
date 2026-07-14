import express from 'express';
import { toPublicUser } from '../utils/mappers.js';
import { listEduAiCourses } from '../services/eduaiClient.js';
import {
  importEnrolledCoursesFromCore,
  importTaughtCoursesFromCore,
  userHasCoreTaEnrollment,
} from '../services/importTaughtCoursesService.js';

const router = express.Router();

// The Core course mirror (import taught + enrolled courses) is a background
// side effect: it fetches Core's course list and writes local CourseOffering /
// CourseEnrollment rows + per-offering topic/enrollment sub-syncs. The `/api/me`
// response does NOT depend on its result. Previously it ran awaited on every
// `/me`, and `/me` runs on every client navigation (via `requireClientUser`),
// so each page paid a serial Core-fetch + DB-write waterfall — the main cause
// of the multi-second per-page delay. We now (a) throttle it to at most once
// per window per user, and (b) fire it without awaiting so navigation never
// blocks on it.
const MIRROR_THROTTLE_MS = Number(process.env.CORE_MIRROR_THROTTLE_MS) || 60_000;
const lastMirrorAtByUser = new Map();

function runCoreMirror(authUser, cookie, sharedOptions) {
  const now = Date.now();
  const last = lastMirrorAtByUser.get(authUser.id) ?? 0;
  if (now - last < MIRROR_THROTTLE_MS) return;
  lastMirrorAtByUser.set(authUser.id, now);

  // Invoke both synchronously (so callers/tests can observe the calls) but do
  // not await — the mirror runs in the background. A user is either an
  // INSTRUCTOR (taught) or a STUDENT/TA (enrolled), so only one actually does
  // work; running them in parallel is safe.
  void Promise.allSettled([
    importTaughtCoursesFromCore(authUser, cookie, sharedOptions).catch((err) =>
      console.error('[eduai] Auto-import taught courses failed', err),
    ),
    importEnrolledCoursesFromCore(authUser, cookie, sharedOptions).catch((err) =>
      console.error('[eduai] Student enrollment mirror failed', err),
    ),
  ]);
}

/** Test-only: clears the per-user mirror throttle so each test starts fresh. */
export function resetCoreMirrorThrottleForTests() {
  lastMirrorAtByUser.clear();
}

router.get('/me', async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: 'Authentication required' });

  const cookie = req.headers.cookie ?? '';
  let coreCourses;

  try {
    coreCourses = await listEduAiCourses({ cookie });
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
