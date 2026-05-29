import prisma from "~/lib/prisma.server";

const VALID_SOURCES = ["AI_TUTOR", "QUESTION_MAKER"] as const;
type BugReportSource = (typeof VALID_SOURCES)[number];

export type CreateBugReportResult =
  | { ok: true }
  | { ok: false; status: 422; error: "VALIDATION_ERROR"; fields: Record<string, string> }
  | { ok: false; status: 422; error: "USER_NOT_FOUND" };

function validationError(fields: Record<string, string>): CreateBugReportResult {
  return { ok: false, status: 422, error: "VALIDATION_ERROR", fields };
}

export async function createBugReport(raw: unknown): Promise<CreateBugReportResult> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return validationError({ body: "invalid payload" });
  }

  const p = raw as Record<string, unknown>;

  if (!VALID_SOURCES.includes(p.source as BugReportSource)) {
    return validationError({ source: "must be AI_TUTOR or QUESTION_MAKER" });
  }

  if (typeof p.userId !== "string" || p.userId.trim().length === 0) {
    return validationError({ userId: "required string" });
  }

  if (typeof p.description !== "string") {
    return validationError({ description: "required string" });
  }

  if (p.description.length > 2000) {
    return validationError({ description: "exceeds 2000 chars" });
  }

  const userId = p.userId.trim();

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) {
    return { ok: false, status: 422, error: "USER_NOT_FOUND" };
  }

  await prisma.bugReport.create({
    data: {
      source: p.source as BugReportSource,
      userId,
      description: p.description,
      isAnonymous: typeof p.isAnonymous === "boolean" ? p.isAnonymous : false,
      consoleLogs: typeof p.consoleLogs === "string" ? p.consoleLogs : null,
      networkLogs: typeof p.networkLogs === "string" ? p.networkLogs : null,
      screenshot: typeof p.screenshot === "string" ? p.screenshot : null,
      pageUrl: typeof p.pageUrl === "string" ? p.pageUrl : null,
      userAgent: typeof p.userAgent === "string" ? p.userAgent : null,
      context:
        p.context && typeof p.context === "object" && !Array.isArray(p.context)
          ? (p.context as Record<string, unknown>)
          : null,
    },
  });

  return { ok: true };
}
