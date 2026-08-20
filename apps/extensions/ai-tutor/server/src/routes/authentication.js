import express from "express";
import { fetchCoreAuthForRequest, isCoreAuthTimeoutError } from "../middleware/auth.js";
import { toPublicUser } from "../utils/mappers.js";
import { listEduAiCourses } from "../services/eduaiClient.js";
import { logSafeError } from "../utils/safeErrors.js";
import {
  runCoreMirror,
  resetCoreMirrorThrottleForTests,
  userHasCoreTaEnrollment,
} from "../services/importTaughtCoursesService.js";

const router = express.Router();

// The Core course mirror is a throttled fire-and-forget background side
// effect shared by every route that triggers it (`runCoreMirror` in
// importTaughtCoursesService — the unified contract's single mirror entry
// point). `/api/me` runs on every client navigation, so it must never await
// the mirror's Core-fetch + DB-write waterfall.
export { resetCoreMirrorThrottleForTests };

router.get("/me", async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: "Authentication required" });

  const cookie = req.headers.cookie ?? "";
  let coreCourses;

  try {
    // #1041: paged upstream; this flow reconciles against the caller's full set.
    coreCourses = await listEduAiCourses({ cookie, all: true });
  } catch (err) {
    logSafeError("[eduai] Core course list failed on /me", err);
    coreCourses = null;
  }

  const sharedOptions = coreCourses != null ? { coreCourses } : {};

  // Fire-and-forget, throttled — does not block the /me response.
  runCoreMirror(authUser, cookie, sharedOptions);

  const publicUser = toPublicUser(authUser);
  let effectiveUser = publicUser;

  if (publicUser && publicUser.role === "STUDENT" && coreCourses != null) {
    try {
      if (await userHasCoreTaEnrollment(cookie, coreCourses)) {
        effectiveUser = { ...publicUser, role: "TA" };
      }
    } catch (err) {
      logSafeError("[eduai] Effective TA role resolution failed on /me", err);
    }
  }

  res.json({ user: effectiveUser });
});

// Proxy sign-out to Core server-to-server, avoiding browser CORS restrictions.
// No requireAuth — Core remains the authority on whether the forwarded session
// can be invalidated. Only acknowledge logout after Core confirms success.
router.post("/logout", async (req, res) => {
  const coreUrl = process.env.CORE_URL || "http://localhost:3000";
  const corePublicOrigin = process.env.CORE_PUBLIC_ORIGIN || coreUrl;
  const serviceKey = process.env.EDUAI_API_KEY?.trim();
  if (!serviceKey) {
    return res.status(503).json({ ok: false, error: "Logout service unavailable" });
  }
  try {
    const coreRes = await fetchCoreAuthForRequest(req, `${coreUrl}/api/auth/sign-out`, {
      method: "POST",
      headers: {
        cookie: req.headers.cookie ?? "",
        origin: corePublicOrigin,
        authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    if (!coreRes.ok) {
      console.error("[ai-tutor] Core sign-out failed", coreRes.status);
      if (coreRes.status === 408 || coreRes.status === 504) {
        return res.status(504).json({ ok: false, error: "Logout service timed out" });
      }
      if (coreRes.status === 429) {
        const retryAfter = coreRes.headers?.get?.("retry-after") ?? null;
        if (retryAfter !== null) res.set("Retry-After", retryAfter);
        return res.status(429).json({ ok: false, error: "Logout rate limited", retryAfter });
      }
      return res.status(503).json({ ok: false, error: "Logout service unavailable" });
    }
    return res.json({ ok: true });
  } catch (err) {
    logSafeError("[ai-tutor] Core sign-out request failed", err);
    if (isCoreAuthTimeoutError(err)) {
      return res.status(504).json({ ok: false, error: "Logout service timed out" });
    }
    return res.status(503).json({ ok: false, error: "Logout service unavailable" });
  }
});

export default router;
