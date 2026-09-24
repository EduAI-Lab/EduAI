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
 * Slack allowed on top of `MAX_CSV_BYTES` for a multipart request.
 *
 * A browser upload wraps the CSV in boundary markers, a `Content-Disposition`
 * header carrying the filename and a handful of CRLFs — on the order of a few
 * hundred bytes for one part. Without this allowance the framing is charged
 * against the CSV's own budget, and a roster a few hundred bytes under the cap
 * is rejected with a message quoting a limit it is genuinely under. 8 KiB is
 * far more than one part needs and negligible against a 256 KiB cap.
 */
const MULTIPART_FRAMING_ALLOWANCE = 8 * 1024;

function isMultipart(request: Request): boolean {
  return (request.headers.get("Content-Type") ?? "").includes("multipart/form-data");
}

/**
 * Pull the body into memory while counting, and give up the moment it goes past
 * `maxBytes`.
 *
 * `request.text()` and `request.formData()` both read the entire body first, so
 * checking a size afterwards is no defence at all: a `Transfer-Encoding:
 * chunked` request declares no `Content-Length`, sails past the header
 * precheck, and is fully buffered before anything gets to object. Counting the
 * chunks as they arrive is the only cap that actually binds.
 *
 * `null` means "over the limit"; the stream is cancelled rather than drained.
 *
 * Backed by an explicitly allocated `ArrayBuffer` so the result is a
 * `Uint8Array<ArrayBuffer>` rather than the `ArrayBufferLike` default, which
 * `BodyInit` does not accept.
 */
async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const stream = request.body;
  if (!stream) return new Uint8Array(new ArrayBuffer(0));

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** `false` when the body exceeded `maxBytes` and was abandoned unread. */
type CsvBodyResult = { ok: true; csv: string } | { ok: false };

/**
 * Accept either a raw `text/csv` body or a multipart upload with a `file`
 * field, because a browser `<input type="file">` posts the latter and scripted
 * callers (curl, admin tooling) post the former. Either way the bytes are
 * counted on the way in.
 */
async function readCsvBody(request: Request, maxBytes: number): Promise<CsvBodyResult> {
  const bytes = await readBoundedBody(request, maxBytes);
  if (bytes === null) return { ok: false };

  if (!isMultipart(request)) {
    return { ok: true, csv: new TextDecoder().decode(bytes) };
  }

  // Hand the bytes we already hold back to the platform's multipart parser
  // rather than re-implementing it — the size decision has been made by now, so
  // this parse is bounded. The Content-Type header is passed through because it
  // carries the boundary the parser needs.
  const form = await new Request(request.url, {
    method: "POST",
    headers: { "Content-Type": request.headers.get("Content-Type") ?? "" },
    body: bytes,
  }).formData();
  const file = form.get("file");
  // `FormData.get` answers with a `File` for a real upload and a string when a
  // caller posted the CSV as a plain field; both are legitimate here.
  if (file instanceof File) return { ok: true, csv: await file.text() };
  return { ok: true, csv: file ?? "" };
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

      // Three checks, narrowing: `Content-Length` is a free early-out when the
      // client is honest, the counting read is the one that actually binds, and
      // the parser has the last word on the CSV itself. The budget here is the
      // whole HTTP body, which for a multipart upload is the CSV plus its
      // framing — the parser still holds the extracted CSV to MAX_CSV_BYTES.
      const maxBodyBytes = MAX_CSV_BYTES + (isMultipart(request) ? MULTIPART_FRAMING_ALLOWANCE : 0);
      // Quote the budget actually applied, not `MAX_CSV_BYTES`: on a multipart
      // request those differ by the framing allowance, and a borderline upload
      // refused at 262,200 bytes should not be told the limit was 262,144.
      const tooLarge = () =>
        jsonResponse(
          { error: "FILE_TOO_LARGE", message: `The maximum upload is ${maxBodyBytes} bytes.` },
          413,
        );

      const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
        return tooLarge();
      }

      const body = await readCsvBody(request, maxBodyBytes);
      if (!body.ok) return tooLarge();

      const parsed = parseEnrollmentCsv(body.csv);
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
