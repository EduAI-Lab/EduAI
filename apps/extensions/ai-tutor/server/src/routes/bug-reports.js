import express from 'express';
import { requireRole, requireRoles } from '../middleware/auth.js';
import {
  BugReportError,
  createBugReport,
  listAdminBugReports,
  updateBugReportStatus,
} from '../services/bugReports.js';
import { mapAdminBugReportRow, mapBugReportSummary } from '../utils/bugReportMappers.js';

const router = express.Router();

router.post('/bug-reports', requireRoles(['STUDENT', 'PROFESSOR']), async (req, res) => {
  try {
    const report = await createBugReport(req.user, req.body || {});
    res.status(201).json(mapBugReportSummary(report));
  } catch (error) {
    if (error instanceof BugReportError) {
      return res.status(error.status).json({ error: error.message });
    }
    res.status(500).json({ error: String(error) });
  }
});

router.get('/admin/bug-reports', requireRole('ADMIN'), async (_req, res) => {
  try {
    const rows = await listAdminBugReports();
    res.json(rows.map(mapAdminBugReportRow));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.patch('/admin/bug-reports/:bugReportId', requireRole('ADMIN'), async (req, res) => {
  try {
    const updated = await updateBugReportStatus(req.params.bugReportId, req.body?.status);
    res.json(mapAdminBugReportRow(updated));
  } catch (error) {
    if (error instanceof BugReportError) {
      return res.status(error.status).json({ error: error.message });
    }
    res.status(500).json({ error: String(error) });
  }
});

export default router;
