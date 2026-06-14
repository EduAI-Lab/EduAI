import express from 'express';
import {
  BugReportError,
  createBugReport,
  listAdminBugReports,
  updateBugReportStatus,
} from '../services/bugReports.js';
import { mapAdminBugReportRow } from '../utils/bugReportMappers.js';
import { requireRole } from '../middleware/auth.js';

const router = express.Router();

router.post('/bug-reports', async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: 'Authentication required' });
  try {
    await createBugReport(authUser, req.body || {});
    res.status(201).json({ ok: true });
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
