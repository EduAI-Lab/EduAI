import express from 'express';
import { toPublicUser } from '../utils/mappers.js';
import { listEduAiCourses } from '../services/eduaiClient.js';
import {
  importEnrolledCoursesFromCore,
  importTaughtCoursesFromCore,
  userHasCoreTaEnrollment,
} from '../services/importTaughtCoursesService.js';

const router = express.Router();

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

  try {
    await importTaughtCoursesFromCore(authUser, cookie, sharedOptions);
  } catch (err) {
    console.error('[eduai] Auto-import taught courses failed on login', err);
  }

  try {
    await importEnrolledCoursesFromCore(authUser, cookie, sharedOptions);
  } catch (err) {
    console.error('[eduai] Student enrollment mirror failed on login', err);
  }

  const publicUser = toPublicUser(authUser);
  let effectiveUser = publicUser;

  // Core dropped the platform-level UserRole.TA (#664): a course TA is now a
  // STUDENT-platform user with Enrollment(role=TA). AI Tutor's client RBAC still
  // routes/gates its *view* off a single role string, so surface an effective TA
  // role here when Core reports a TA enrollment — otherwise course TAs land in the
  // student shell after the Core migration deploys. Per-course server authorization
  // already keys off enrollment.role and is unaffected.
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
