import express from "express";
import { requireRole } from "../middleware/auth.js";
import { getEduAiCookieForRequest } from "../services/eduaiAuth.js";
import {
  BugReportError,
  createBugReport,
  getAdminBugReport,
  listAdminBugReports,
  updateBugReportStatus,
} from "../services/bugReports.js";
import { logSafeError, sendSafeError } from "../utils/safeErrors.js";
import {
  BugReportCreateSchema,
  BugReportStatusUpdateSchema,
} from "../../../shared/schemas/mutations.js";

const router = express.Router();

router.post("/bug-reports", async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: "Authentication required" });
  const parsedBody = BugReportCreateSchema.safeParse(req.body);
  if (!parsedBody.success) {
    const issue = parsedBody.error.issues[0];
    const descriptionIssue = issue?.path[0] === "description";
    return res.status(400).json({
      error: descriptionIssue
        ? "description must be between 10 and 2000 characters"
        : "Invalid payload",
    });
  }
  try {
    await createBugReport(authUser, parsedBody.data);
    res.status(201).json({ ok: true });
  } catch (error) {
    if (error instanceof BugReportError) {
      return res.status(error.status).json({ error: error.message });
    }
    logSafeError("[bug-reports] create failed", error);
    sendSafeError(res, error, "Unable to submit bug report");
  }
});

router.get("/admin/bug-reports", requireRole("ADMIN"), async (req, res) => {
  try {
    const cookie = getEduAiCookieForRequest(req);
    const rows = await listAdminBugReports(cookie);
    res.json(rows);
  } catch (error) {
    logSafeError("[bug-reports] list failed", error);
    const status = typeof error?.status === "number" ? error.status : 500;
    sendSafeError(res, error, "Unable to load bug reports", { status });
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
    logSafeError("[bug-reports] get failed", error);
    const status = typeof error?.status === "number" ? error.status : 500;
    sendSafeError(res, error, "Unable to load bug report", { status });
  }
});

router.patch("/admin/bug-reports/:bugReportId", requireRole("ADMIN"), async (req, res) => {
  const parsedBody = BugReportStatusUpdateSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: "Invalid bug report status" });
  }
  try {
    const cookie = getEduAiCookieForRequest(req);
    const updated = await updateBugReportStatus(
      req.params.bugReportId,
      parsedBody.data.status,
      cookie,
    );
    res.json(updated);
  } catch (error) {
    if (error instanceof BugReportError) {
      return res.status(error.status).json({ error: error.message });
    }
    logSafeError("[bug-reports] update failed", error);
    sendSafeError(res, error, "Unable to update bug report");
  }
});

export default router;
