/**
 * POST /api/courses/:id/enrollments/csv — bulk-enroll from a roster CSV (#1756).
 *
 * The file format lives in `~/lib/courses/enrollments-csv.server`; this route
 * only does HTTP: authorize, read the body, map the parse/import result onto a
 * status code, and audit-log the writes.
 *
 * Authorization is deliberately identical to the single-add path
 * (`POST /api/courses/:id/enrollments`): rank >= 2 plus the `manageEnrollments`
 * policy gate to get in at all, and then the SAME `actorRank` handed down to
 * `addEnrollment` per row. Bulk import must never be a way for an INSTRUCTOR to
 * mint another INSTRUCTOR — that check is not re-implemented here, it is the
 * one in `canAddEnrollmentRole`, reached through `importEnrollmentRows`.
 *
 * Not transactional: see the module comment on enrollments-csv.server.ts. A
 * partial import is reported row by row rather than rolled back.
 */
import type { ActionFunctionArgs } from "react-router";

import { jsonResponse } from "~/lib/api/json-response.server";
import { resolveCourseAccessGate } from "~/lib/auth/course-access.server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import {
  importEnrollmentRows,
  parseEnrollmentCsv,
  MAX_CSV_BYTES,
} from "~/lib/courses/enrollments-csv.server";
import { withErrorResponse } from "~/lib/errors.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { denyByPolicy, getPolicy } from "~/lib/policy.server";
import { resolvePolicyGate } from "~/lib/rbac/permissions";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

/** §6: managing enrollments at all is rank >= 2. Per-row role rules sit below that. */
const MANAGE_ENROLLMENTS_RANK = 2;

/**
 * Size rejections are 413; format rejections are 422. Inferred rather than
 * annotated so the keys stay pinned to `EnrollmentCsvFileErrorCode` — adding a
 * file-level error code without a status here becomes a type error at the
 * lookup site.
 */
const FILE_ERROR_STATUS = {
  FILE_TOO_LARGE: 413,
  TOO_MANY_ROWS: 413,
  EMPTY_FILE: 422,
  MISSING_EMAIL_COLUMN: 422,
} as const;

/**
 * Accept either a raw `text/csv` body or a multipart upload with a `file`
 * field, because a browser `<input type="file">` posts the latter and scripted
 * callers (curl, admin tooling) post the former.
 */
async function readCsvBody(request: Request): Promise<string> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return request.text();
  }
  const form = await request.formData();
  const file = form.get("file");
  // `FormData.get` answers with a `File` for a real upload and a string when a
  // caller posted the CSV as a plain field; both are legitimate here.
  if (file instanceof File) return file.text();
  return file ?? "";
}

export async function action({ request, params }: ActionFunctionArgs) {
  return withErrorResponse(
    async () => {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const courseId = params.id;
      if (!courseId) {
        return jsonResponse({ error: "COURSE_ID_REQUIRED" }, 400);
      }

      const session = await getRequestSession(request);
      if (!session?.user) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const { course, access } = await resolveCourseAccessGate(session.user, courseId);
      if (!course) {
        return jsonResponse({ error: "COURSE_NOT_FOUND" }, 404);
      }
      if (!access || access.rank < MANAGE_ENROLLMENTS_RANK) {
        return jsonResponse({ error: "Forbidden" }, 403);
      }

      const enrollmentGate = resolvePolicyGate(access.level, "manageEnrollments");
      if (
        enrollmentGate !== "always" &&
        enrollmentGate !== "never" &&
        !(await getPolicy(enrollmentGate))
      ) {
        return denyByPolicy({
          request,
          policyKey: enrollmentGate,
          user: session.user,
          action: "enrollment.csv-import",
          courseId,
        });
      }

      // Reject an oversized upload before buffering it. The parser re-checks the
      // real byte length, since Content-Length is client-supplied and optional.
      const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > MAX_CSV_BYTES) {
        return jsonResponse(
          { error: "FILE_TOO_LARGE", message: `The maximum upload is ${MAX_CSV_BYTES} bytes.` },
          413,
        );
      }

      const parsed = parseEnrollmentCsv(await readCsvBody(request));
      if (!parsed.ok) {
        return jsonResponse(
          { error: parsed.error, message: parsed.message },
          FILE_ERROR_STATUS[parsed.error],
        );
      }

      const summary = await importEnrollmentRows(courseId, parsed.rows, parsed.errors, access.rank);

      const actorContext = getActorContext(session.user);
      const requestContext = getRequestContext(request);
      // One entry per created enrollment, exactly as the single-add route logs,
      // so a bulk import is not an audit blind spot; plus a summary row that
      // records the shape of the upload itself.
      for (const row of summary.created) {
        fireAndForget(
          logAuditAction({
            ...actorContext,
            ...requestContext,
            actionCode: "ENROLLMENT_ADDED",
            category: "ENROLLMENT",
            entityType: "Enrollment",
            entityId: row.enrollmentId,
            details: { courseId, role: row.role, targetUserId: row.userId, source: "CSV_IMPORT" },
          }),
        );
      }
      fireAndForget(
        logAuditAction({
          ...actorContext,
          ...requestContext,
          actionCode: "ENROLLMENT_CSV_IMPORTED",
          category: "ENROLLMENT",
          entityType: "Course",
          entityId: courseId,
          details: {
            courseId,
            totalRows: summary.totalRows,
            imported: summary.imported,
            alreadyEnrolled: summary.alreadyEnrolled,
            failed: summary.failed,
          },
        }),
      );

      // `created` stays server-side: the client needs the counts and the failed
      // line numbers, not a copy of the roster it just uploaded.
      return jsonResponse({
        totalRows: summary.totalRows,
        imported: summary.imported,
        alreadyEnrolled: summary.alreadyEnrolled,
        failed: summary.failed,
        errors: summary.errors,
      });
    },
    { request },
  );
}
