import express from "express";
import { requireRole } from "../middleware/auth.js";
import { getEduAiCookieForRequest } from "../services/eduaiAuth.js";
import {
  BugReportError,
  createBugReport,
  getAdminBugReport,
  listAdminBugReports,
  updateBugReportStatus,
} from '../services/bugReports.js';
import { logSafeError, sendSafeError } from '../utils/safeErrors.js';

const router = express.Router();

router.post("/bug-reports", async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: "Authentication required" });
  try {
    await createBugReport(authUser, req.body || {});
    res.status(201).json({ ok: true });
  } catch (error) {
    if (error instanceof BugReportError) {
      return res.status(error.status).json({ error: error.message });
    }
    logSafeError('[bug-reports] create failed', error);
    sendSafeError(res, error, 'Unable to submit bug report');
  }
});

router.get("/admin/bug-reports", requireRole("ADMIN"), async (req, res) => {
  try {
    const cookie = getEduAiCookieForRequest(req);
    const rows = await listAdminBugReports(cookie);
    res.json(rows);
  } catch (error) {
    logSafeError('[bug-reports] list failed', error);
    const status = typeof error?.status === 'number' ? error.status : 500;
    sendSafeError(res, error, 'Unable to load bug reports', { status });
  }
});

router.get("/admin/bug-reports/:bugReportId", requireRole("ADMIN"), async (req, res) => {
  try {
    const cookie = getEduAiCookieForRequest(req);
    const row = await getAdminBugReport(cookie, req.params.bugReportId);
    res.json(row);
  } catch (error) {
    if (error instanceof BugReportError) {
      return res.status(error.status).json({ error: error.message });
    }
    logSafeError('[bug-reports] get failed', error);
    const status = typeof error?.status === 'number' ? error.status : 500;
    sendSafeError(res, error, 'Unable to load bug report', { status });
  }
});

router.patch("/admin/bug-reports/:bugReportId", requireRole("ADMIN"), async (req, res) => {
  try {
    const cookie = getEduAiCookieForRequest(req);
    const updated = await updateBugReportStatus(req.params.bugReportId, req.body?.status, cookie);
    res.json(updated);
  } catch (error) {
    if (error instanceof BugReportError) {
      return res.status(error.status).json({ error: error.message });
    }
    logSafeError('[bug-reports] update failed', error);
    sendSafeError(res, error, 'Unable to update bug report');
  }
});

export default router;
