import express from 'express';
import { requireRole, requireRoles } from '../middleware/auth.js';
import { getEduAiCookieForRequest } from '../services/eduaiAuth.js';
import {
  BugReportError,
  createBugReport,
  listAdminBugReports,
  updateBugReportStatus,
} from '../services/bugReports.js';
import { mapCoreAdminBugReportRow } from '../utils/bugReportMappers.js';

const router = express.Router();

router.post('/bug-reports', requireRoles(['STUDENT', 'INSTRUCTOR']), async (req, res) => {
  try {
    await createBugReport(req.user, req.body || {});
    res.status(201).json({ ok: true });
  } catch (error) {
    if (error instanceof BugReportError) {
      return res.status(error.status).json({ error: error.message });
    }
    res.status(500).json({ error: String(error) });
  }
});

router.get('/admin/bug-reports', requireRole('ADMIN'), async (req, res) => {
  try {
    const cookie = getEduAiCookieForRequest(req);
    const rows = await listAdminBugReports(cookie);
    res.json(rows.map(mapCoreAdminBugReportRow));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.patch('/admin/bug-reports/:bugReportId', requireRole('ADMIN'), async (req, res) => {
  try {
    const cookie = getEduAiCookieForRequest(req);
    const updated = await updateBugReportStatus(cookie, req.params.bugReportId, req.body?.status);
    res.json(updated);
  } catch (error) {
    if (error instanceof BugReportError) {
      return res.status(error.status).json({ error: error.message });
    }
    res.status(500).json({ error: String(error) });
  }
});

export default router;
