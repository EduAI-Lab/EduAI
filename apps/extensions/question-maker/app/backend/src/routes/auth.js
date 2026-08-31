import express from "express";
import {
  fetchCoreAuthForRequest,
  isCoreAuthTimeoutError,
  requireAuth,
} from "../middleware/auth.js";
import { config } from "../config/settings.js";
import { getMyProfileFromCore, listCoursesFromCore } from "../services/coreApiService.js";

const router = express.Router();

// §11: bug-report triage is ADMIN-only (role-based, replacing the prior email allowlist).
router.get("/auth/me", requireAuth, async (req, res, next) => {
  try {
    const isBugReportAdmin = req.user.role === "ADMIN";
    let authorizedUnits;

    if (req.user.role === "UNIT_ADMIN") {
      const profile = await getMyProfileFromCore(req.headers.cookie).catch(() => null);
      authorizedUnits = Array.isArray(profile?.authorizedUnits) ? profile.authorizedUnits : [];
    }

    let questionMakerRole;
    if (req.user.role === "STUDENT") {
      let courses;
      try {
        courses = await listCoursesFromCore(req.headers.cookie ?? "", { all: true });
      } catch {
        return res.status(503).json({ error: "Question Maker authorization unavailable" });
      }
      if (courses.some((course) => course?.callerEnrollmentRole === "TA")) {
        questionMakerRole = "TA";
      }
    }

    // Core's session payload already carries `authorizedUnits`, so the freshly
    // fetched list is layered on by statement, since an explicit `undefined` here
    // would erase the spread's value for every non-UNIT_ADMIN caller.
    const user = { ...req.user, isBugReportAdmin };
    if (authorizedUnits !== undefined) user.authorizedUnits = authorizedUnits;
    if (questionMakerRole !== undefined) user.questionMakerRole = questionMakerRole;

    res.json({ user });
  } catch (error) {
    next(error);
  }
});

// Proxy sign-out to Core server-to-server, avoiding browser CORS restrictions.
// No requireAuth — Core remains the authority on whether the forwarded session
// can be invalidated. Only acknowledge logout after Core confirms success.
router.post("/auth/logout", async (req, res) => {
  if (!config.eduaiApiKey) {
    return res.status(503).json({ ok: false, error: "Logout service unavailable" });
  }
  try {
    const coreRes = await fetchCoreAuthForRequest(req, `${config.coreUrl}/api/auth/sign-out`, {
      method: "POST",
      headers: {
        cookie: req.headers.cookie ?? "",
        origin: config.corePublicOrigin,
        authorization: `Bearer ${config.eduaiApiKey}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    if (!coreRes.ok) {
      console.error("[question-maker] Core sign-out failed", coreRes.status);
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
    console.error("[question-maker] Core sign-out request failed", err);
    if (isCoreAuthTimeoutError(err)) {
      return res.status(504).json({ ok: false, error: "Logout service timed out" });
    }
    return res.status(503).json({ ok: false, error: "Logout service unavailable" });
  }
});

export default router;
