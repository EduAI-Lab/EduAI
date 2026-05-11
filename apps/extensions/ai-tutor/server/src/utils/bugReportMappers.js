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
    courseTitle: row.courseOffering?.title ?? null,
    moduleTitle: row.module?.title ?? null,
    lessonTitle: row.lesson?.title ?? null,
    activityTitle: resolveActivityTitle(row.activity),
  };
}
