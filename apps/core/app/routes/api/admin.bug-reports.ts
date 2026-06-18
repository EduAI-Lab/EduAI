/**
 * /api/admin/bug-reports (#304, §11) — ADMIN-only triage surface.
 *
 * GET  /api/admin/bug-reports?source=&status=&limit=&offset=
 *      Lists reports across all three apps. Anonymous reports surface with
 *      userId/email/name masked (identity stays in the DB for audit).
 * PATCH /api/admin/bug-reports/:id — change BugReportStatus.
 *
 * AI Tutor's admin bug-report routes proxy here once wired.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import {
  isBugReportSource,
  isBugReportStatus,
  listBugReports,
  updateBugReportStatus,
} from "~/lib/bug-reports/server";
import { fireAndForget, logAuditAction, logSecurityEvent } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function requireAdmin(request: Request) {
  const requestContext = getRequestContext(request);

  // Records an admin-only access rejection so security triage can spot probing of the bug-report API.
  const logAdminDenied = (actor: { id: string; role?: string | null } | null) =>
    fireAndForget(
      logSecurityEvent({
        ...getActorContext(actor),
        ...requestContext,
        actionCode: "ADMIN_ACCESS_DENIED",
        outcome: "DENIED",
        entityType: "BugReport",
      }),
    );

  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return { response: apiKeyGuard, session: null };

  const session = apiKeySession ?? (await auth.api.getSession(request));
  if (!session?.user) {
    logAdminDenied(null);
    return { response: json(401, { error: "Unauthorized" }), session: null };
  }
  if (session.user.role !== "ADMIN") {
    logAdminDenied(session.user);
    return { response: json(403, { error: "Forbidden" }), session: null };
  }
  return { response: null, session };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { response } = await requireAdmin(request);
  if (response) return response;

  const url = new URL(request.url);
  const sourceParam = url.searchParams.get("source");
  const statusParam = url.searchParams.get("status");

  let source: Parameters<typeof listBugReports>[0]["source"];
  if (sourceParam !== null) {
    if (!isBugReportSource(sourceParam)) {
      return json(400, { error: "INVALID_SOURCE" });
    }
    source = sourceParam;
  }

  let status: Parameters<typeof listBugReports>[0]["status"];
  if (statusParam !== null) {
    if (!isBugReportStatus(statusParam)) {
      return json(400, { error: "INVALID_STATUS" });
    }
    status = statusParam;
  }

  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10) || 50;
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;

  const result = await listBugReports({ source, status, limit, offset });

  return json(200, result);
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "PATCH") {
    return json(405, { error: "Method not allowed" });
  }

  const { response, session } = await requireAdmin(request);
  if (response) return response;

  const requestContext = getRequestContext(request);

  const reportId = params.id;
  if (!reportId) {
    return json(400, { error: "REPORT_ID_REQUIRED" });
  }

  const body = await request.json().catch(() => ({}));
  if (!isBugReportStatus(body?.status)) {
    return json(422, {
      error: "VALIDATION_ERROR",
      fields: { status: "must be UNHANDLED, IN_PROGRESS, or RESOLVED" },
    });
  }

  const result = await updateBugReportStatus(reportId, body.status);
  if (!result) {
    return json(404, { error: "REPORT_NOT_FOUND" });
  }

  fireAndForget(
    logAuditAction({
      ...getActorContext(session?.user ?? null),
      ...requestContext,
      actionCode: "BUG_REPORT_STATUS_CHANGED",
      category: "BUG_REPORT",
      entityType: "BugReport",
      entityId: reportId,
      details: { status: body.status },
    }),
  );

  return json(200, result);
}
