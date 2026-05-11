/**
 * Persists bug reports and supports admin listing/status updates.
 */
import { BugReport, User } from '../schema/index.js';

const ALLOWED_STATUS = new Set(['unhandled', 'in progress', 'resolved']);

/** Primary admin for bug dashboard (register this account in the app; no separate admin role table). */
export const DEFAULT_BUG_REPORT_ADMIN_EMAIL = 'admin@mail.com';

/**
 * Extra bug admins from BUG_REPORT_ADMIN_EMAILS (comma-separated), evaluated on each call.
 * The default admin email is always allowed in addition to this list.
 */
function extraBugReportAdminEmailSet() {
  return new Set(
    (process.env.BUG_REPORT_ADMIN_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** @param {string} [email] */
export function isBugReportAdminEmail(email) {
  if (!email) {
    return false;
  }
  const normalized = email.trim().toLowerCase();
  if (normalized === DEFAULT_BUG_REPORT_ADMIN_EMAIL) {
    return true;
  }
  return extraBugReportAdminEmailSet().has(normalized);
}

/**
 * @param {object} params
 * @param {number} params.userId
 * @param {string} params.description
 * @param {string} [params.consoleLogs]
 * @param {string} [params.networkLogs]
 * @param {string | null} [params.screenshot]
 * @param {string} [params.pageUrl]
 * @param {string} [params.userAgent]
 * @param {boolean} [params.isAnonymous]
 */
export async function createBugReport(params) {
  const {
    userId,
    description,
    consoleLogs,
    networkLogs,
    screenshot,
    pageUrl,
    userAgent,
    isAnonymous = false
  } = params;

  const trimmed = typeof description === 'string' ? description.trim() : '';
  if (trimmed.length < 10 || trimmed.length > 2000) {
    throw new Error('Description must be between 10 and 2000 characters');
  }

  let screenshotValue = screenshot;
  if (typeof screenshotValue === 'string' && screenshotValue.length > 6_000_000) {
    screenshotValue = null;
  }

  return BugReport.create({
    userId,
    description: trimmed,
    consoleLogs: typeof consoleLogs === 'string' ? consoleLogs : null,
    networkLogs: typeof networkLogs === 'string' ? networkLogs : null,
    screenshot: screenshotValue,
    pageUrl: typeof pageUrl === 'string' ? pageUrl.slice(0, 1000) : null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 500) : null,
    isAnonymous: Boolean(isAnonymous)
  });
}

export async function listBugReportsForAdmin() {
  return BugReport.findAll({
    order: [['createdAt', 'DESC']],
    include: [{ model: User, as: 'user', attributes: ['id', 'email'] }]
  });
}

/**
 * @param {number} bugId
 * @param {string} status
 */
export async function updateBugReportStatus(bugId, status) {
  if (!ALLOWED_STATUS.has(status)) {
    throw new Error('Invalid status');
  }
  const bug = await BugReport.findByPk(bugId);
  if (!bug) {
    throw new Error('Bug report not found');
  }
  await bug.update({ status });
  return bug;
}
