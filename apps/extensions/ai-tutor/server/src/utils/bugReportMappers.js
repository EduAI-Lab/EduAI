function parseActivityFallbackTitle(config) {
  if (!config || typeof config !== 'object') {
    return null;
  }

  if (typeof config.question === 'string' && config.question.trim().length > 0) {
    return config.question.trim();
  }
  if (typeof config.prompt === 'string' && config.prompt.trim().length > 0) {
    return config.prompt.trim();
  }
  return null;
}

function resolveActivityTitle(activity) {
  if (!activity) {
    return null;
  }
  if (typeof activity.title === 'string' && activity.title.trim().length > 0) {
    return activity.title.trim();
  }
  return parseActivityFallbackTitle(activity.config);
}

const CORE_TO_UI_STATUS = {
  UNHANDLED: 'unhandled',
  IN_PROGRESS: 'in progress',
  RESOLVED: 'resolved',
};

export const UI_TO_CORE_BUG_STATUS = {
  unhandled: 'UNHANDLED',
  'in progress': 'IN_PROGRESS',
  resolved: 'RESOLVED',
};

function parseCoreContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return {};
  }
  return context;
}

/** Map a Core admin bug-report row into the AI Tutor admin table shape (#648). */
export function mapCoreAdminBugReportRow(report) {
  const context = parseCoreContext(report.context);
  const isAnonymous = Boolean(report.isAnonymous);
  const status =
    CORE_TO_UI_STATUS[report.status] ?? String(report.status ?? 'UNHANDLED').toLowerCase();
  const userId = report.userId ?? 'unknown';

  return {
    id: report.id,
    description: report.description,
    bugType: report.bugType ?? null,
    status,
    consoleLogs: report.consoleLogs ?? null,
    networkLogs: report.networkLogs ?? null,
    screenshot: report.screenshot ?? null,
    hasConsoleLogs: Boolean(
      report.hasConsoleLogs ?? (report.consoleLogs != null && report.consoleLogs !== ''),
    ),
    hasNetworkLogs: Boolean(
      report.hasNetworkLogs ?? (report.networkLogs != null && report.networkLogs !== ''),
    ),
    hasScreenshot: Boolean(
      report.hasScreenshot ?? (report.screenshot != null && report.screenshot !== ''),
    ),
    pageUrl: report.pageUrl ?? null,
    userAgent: report.userAgent ?? null,
    isAnonymous,
    userId,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    reporterName: isAnonymous ? 'Anonymous' : (report.userName ?? null),
    reporterEmail: isAnonymous ? null : (report.userEmail ?? null),
    reporterRole: null,
    user: {
      id: userId,
      name: isAnonymous ? null : (report.userName ?? null),
      email: isAnonymous ? null : (report.userEmail ?? null),
      role: null,
    },
    courseOfferingId: context.courseOfferingId ?? null,
    moduleId: context.moduleId ?? null,
    lessonId: context.lessonId ?? null,
    activityId: context.activityId ?? null,
    courseTitle: context.courseTitle ?? null,
    moduleTitle: context.moduleTitle ?? null,
    lessonTitle: context.lessonTitle ?? null,
    activityTitle: context.activityTitle ?? null,
  };
}

export function mapBugReportSummary(row) {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    isAnonymous: row.isAnonymous,
    context: {
      courseOfferingId: row.courseOfferingId ?? null,
      moduleId: row.moduleId ?? null,
      lessonId: row.lessonId ?? null,
      activityId: row.activityId ?? null,
    },
  };
}

export function mapAdminBugReportRow(row) {
  const user = row.user ?? null;
  const isAnonymous = Boolean(row.isAnonymous);

  return {
    id: row.id,
    description: row.description,
    bugType: row.bugType ?? null,
    status: row.status,
    consoleLogs: row.consoleLogs ?? null,
    networkLogs: row.networkLogs ?? null,
    screenshot: row.screenshot ?? null,
    pageUrl: row.pageUrl ?? null,
    userAgent: row.userAgent ?? null,
    isAnonymous,
    userId: row.userId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    reporterName: isAnonymous ? 'Anonymous' : (user?.name ?? null),
    reporterEmail: isAnonymous ? null : (user?.email ?? null),
    reporterRole: user?.role ?? null,
    user: {
      id: user?.id ?? row.userId,
      name: isAnonymous ? null : (user?.name ?? null),
      email: isAnonymous ? null : (user?.email ?? null),
      role: user?.role ?? null,
    },
    courseOfferingId: row.courseOfferingId ?? null,
    moduleId: row.moduleId ?? null,
    lessonId: row.lessonId ?? null,
    activityId: row.activityId ?? null,
    // `title` is Core-owned (#1072 step 4) — no local CourseOffering column
    // to read. Dead code path (no caller populates `row.courseOffering`
    // with a title select today), kept null rather than wired to a Core
    // fetch until this mapper is actually exercised.
    courseTitle: null,
    moduleTitle: row.module?.title ?? null,
    lessonTitle: row.lesson?.title ?? null,
    activityTitle: resolveActivityTitle(row.activity),
  };
}
