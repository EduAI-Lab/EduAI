/**
 * Authenticated bug report submission and admin-only listing/status updates.
 */
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  createBugReport,
  isBugReportAdminEmail,
  listBugReportsForAdmin,
  updateBugReportStatus
} from '../services/bugReportService.js';

const router = express.Router();

function requireBugReportAdmin(req, res, next) {
  if (!isBugReportAdminEmail(req.user.email)) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden'
    });
  }
  next();
}

router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const {
      description,
      consoleLogs,
      networkLogs,
      screenshot,
      pageUrl,
      userAgent,
      isAnonymous
    } = req.body ?? {};

    const bug = await createBugReport({
      userId: req.user.id,
      description,
      consoleLogs,
      networkLogs,
      screenshot,
      pageUrl,
      userAgent,
      isAnonymous
    });

    res.status(201).json({
      success: true,
      data: { id: bug.id }
    });
  } catch (error) {
    if (error.message?.includes('Description must')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    next(error);
  }
});

router.get('/', authenticateToken, requireBugReportAdmin, async (req, res, next) => {
  try {
    const rows = await listBugReportsForAdmin();
    const data = rows.map((b) => ({
      id: b.id,
      description: b.description,
      status: b.status,
      consoleLogs: b.consoleLogs,
      networkLogs: b.networkLogs,
      screenshot: b.screenshot,
      pageUrl: b.pageUrl,
      userAgent: b.userAgent,
      isAnonymous: b.isAnonymous,
      userId: b.userId,
      user: b.user ? { email: b.user.email } : { email: '' },
      createdAt: b.createdAt?.toISOString?.() ?? b.createdAt
    }));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', authenticateToken, requireBugReportAdmin, async (req, res, next) => {
  try {
    const bugId = parseInt(req.params.id, 10);
    if (Number.isNaN(bugId)) {
      return res.status(400).json({ success: false, error: 'Invalid id' });
    }
    const { status } = req.body ?? {};
    if (!status) {
      return res.status(400).json({ success: false, error: 'status is required' });
    }
    const updated = await updateBugReportStatus(bugId, status);
    res.json({
      success: true,
      data: {
        id: updated.id,
        status: updated.status
      }
    });
  } catch (error) {
    if (error.message === 'Invalid status') {
      return res.status(400).json({ success: false, error: error.message });
    }
    if (error.message === 'Bug report not found') {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
});

export default router;
