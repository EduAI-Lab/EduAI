/**
 * Course materials API. DELETE uses soft-delete (sets deletedAt/deletedBy).
 * One-way contract: material deletes are NEVER propagated to Canvas — Core owns the deletion.
 * Extensions may rely on deletedAt being set to detect EduAI-side removals.
 */

import type { Prisma } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createHash } from "crypto";
import { validateUploadedFile } from "~/lib/ai/file-processing";
import prisma from "~/lib/prisma.server";
import {
  PENDING_CHECKSUM_PREFIX,
  ensureMaterialSweeperRunning,
  isChecksumConflict,
  persistUploadBlob,
  startMaterialExtraction,
  toBytesColumn,
} from "~/lib/materials/extraction-job.server";
import {
  resolveCourseAccessGate,
  wantsIncludeDeleted,
  type AccessLevel,
} from "~/lib/auth/course-access.server";
import { getPolicy, denyByPolicy } from "~/lib/policy.server";
import type { Session } from "~/lib/auth/server";
import { toMaterialUploadUserMessage } from "~/lib/material-upload-errors";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import { parseCursorParams, splitPage } from "~/lib/cursor-list.server";
import {
  MultipartBodyInvalidError,
  MultipartBodyTooLargeError,
  readBoundedFormData,
} from "~/lib/multipart.server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { MATERIAL_UPLOAD_BODY_MAX_BYTES } from "~/lib/materials/constants";
import type { JsonResponseBody } from "~/lib/api/json-response.server";

function json(status: number, body: JsonResponseBody) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Audit `details` for a material edit. Every field past `courseId` is optional
 * because a rename and a visibility change are recorded independently — the
 * absent keys are what tell a reader which half of the edit did not happen.
 */
type MaterialEditAuditDetails = {
  courseId: string;
  previousTitle?: string;
  newTitle?: string;
  previousVisibleToStudents?: boolean;
  newVisibleToStudents?: boolean;
  previousAvailableAt?: Date | null;
  newAvailableAt?: Date | null;
};

/**
 * Staff (INSTRUCTOR/TA/ADMIN/UNIT_ADMIN) see every material so they can stage
 * and schedule content; only students are subject to the per-material
 * visibility gate. `access.level === 'student'` is the single student marker.
 */
function isStaffAccess(access: AccessLevel): boolean {
  return access.level !== "student";
}

/**
 * Prisma `where` fragment that hides materials students shouldn't see yet:
 * Canvas-unpublished (`unpublishedAt`), selectively excluded Canvas files,
 * explicitly hidden (`visibleToStudents: false`), or scheduled for a future
 * reveal (`availableAt` in the future). Staff callers must NOT apply this.
 *
 * When `excludedCanvasFileIds` is empty the availableAt clause stays a top-level
 * `OR` so scheduling tests remain readable; with exclusions an `AND` wraps both
 * OR groups so Prisma doesn't overwrite one with the other.
 */
function studentVisibilityWhere(now: Date, excludedCanvasFileIds: string[] = []) {
  const availableAtGate = {
    OR: [{ availableAt: null }, { availableAt: { lte: now } }],
  };
  const exclusionGate =
    excludedCanvasFileIds.length > 0
      ? {
          OR: [{ externalId: null }, { externalId: { notIn: excludedCanvasFileIds } }],
        }
      : null;

  return {
    unpublishedAt: null,
    visibleToStudents: true,
    ...(exclusionGate ? { AND: [availableAtGate, exclusionGate] } : availableAtGate),
  };
}

/**
 * Shared auth resolution for all material routes: session + §7 course access.
 * Returns a Response on failure, or the session user + access on success.
 */
async function resolveMaterialsAccess(
  request: Request,
  courseId: string,
): Promise<
  | { response: Response; user?: never; access?: never; isPublished?: never }
  | { response?: never; user: Session["user"]; access: AccessLevel; isPublished: boolean }
> {
  const session = await getRequestSession(request);
  if (!session?.user) {
    return { response: json(401, { error: "Unauthorized" }) };
  }

  const { course, access } = await resolveCourseAccessGate(session.user, courseId);
  if (!course) {
    return { response: json(404, { error: "COURSE_NOT_FOUND" }) };
  }
  if (!access) {
    return { response: json(403, { error: "Forbidden" }) };
  }

  return { user: session.user, access, isPublished: course.isPublished };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const courseId = params.courseId;
  if (!courseId) {
    return json(400, { error: "Course ID is required" });
  }

  const resolved = await resolveMaterialsAccess(request, courseId);
  if (resolved.response) return resolved.response;
  const { user, access, isPublished } = resolved;

  const requestContext = getRequestContext(request);

  switch (request.method) {
    case "POST": {
      // §7: upload is ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) / TA(C).
      // Students cannot upload materials UNLESS the students.canUploadMaterials
      // grant is explicitly enabled (off by default).
      const studentUploadAllowed =
        access.level === "student" && (await getPolicy("students.canUploadMaterials"));
      if (access.rank < 1 && !studentUploadAllowed) {
        return denyByPolicy({
          request,
          policyKey: "students.canUploadMaterials",
          user,
          action: "material.upload",
          courseId,
        });
      }
      // §7/§19: a student may upload only in a PUBLISHED course — mirror the
      // list gate (loader 403s students in unpublished courses) so student
      // content can't be seeded into a draft course's RAG corpus. Higher ranks
      // legitimately work in unpublished courses. This is a publish-state gate,
      // NOT a policy-flag denial: the `students.canUploadMaterials` grant may be
      // on, so don't mislabel the audit trail with it — return a distinct 403.
      if (access.level === "student" && !isPublished) {
        return json(403, { error: "COURSE_NOT_PUBLISHED" });
      }
      // Gate: a TA is allowed by default; deny only when the gate is off.
      if (access.level === "ta" && !(await getPolicy("tas.canManageMaterials"))) {
        return denyByPolicy({
          request,
          policyKey: "tas.canManageMaterials",
          user,
          action: "material.upload",
          courseId,
        });
      }
      return uploadMaterial(request, courseId, user, requestContext);
    }

    case "PATCH":
    case "PUT": {
      const materialId = params.materialId;
      if (!materialId) {
        return json(400, { error: "MATERIAL_ID_REQUIRED" });
      }

      let body: { title?: unknown; visibleToStudents?: unknown; availableAt?: unknown };
      try {
        body = await request.json();
      } catch {
        return json(400, { error: "INVALID_BODY" });
      }

      const hasTitle = body.title !== undefined;
      const hasVisibility = body.visibleToStudents !== undefined;
      const hasAvailableAt = body.availableAt !== undefined;

      // Only the fields the request actually carried are written, so this
      // starts empty and is filled key by key below.
      const data: Prisma.CourseMaterialUpdateInput = {};

      if (hasTitle) {
        const rawTitle = typeof body.title === "string" ? body.title.trim() : "";
        if (!rawTitle) {
          return json(400, { error: "TITLE_REQUIRED" });
        }
        if (rawTitle.length > 255) {
          return json(400, { error: "TITLE_TOO_LONG" });
        }
        data.title = rawTitle;
      }

      if (hasVisibility) {
        if (typeof body.visibleToStudents !== "boolean") {
          return json(400, { error: "INVALID_VISIBILITY" });
        }
        data.visibleToStudents = body.visibleToStudents;
      }

      if (hasAvailableAt) {
        // null clears the schedule; a valid ISO string sets a future/past reveal.
        if (body.availableAt === null) {
          data.availableAt = null;
        } else if (typeof body.availableAt === "string") {
          const parsed = new Date(body.availableAt);
          if (Number.isNaN(parsed.getTime())) {
            return json(400, { error: "INVALID_AVAILABLE_AT" });
          }
          data.availableAt = parsed;
        } else {
          return json(400, { error: "INVALID_AVAILABLE_AT" });
        }
      }

      if (Object.keys(data).length === 0) {
        return json(400, { error: "NO_FIELDS" });
      }

      const material = await prisma.courseMaterial.findFirst({
        where: { id: materialId, courseId, deletedAt: null },
        select: {
          id: true,
          uploadedBy: true,
          title: true,
          visibleToStudents: true,
          availableAt: true,
        },
      });
      if (!material) {
        return json(404, { error: "MATERIAL_NOT_FOUND" });
      }

      // §7: edit mirrors delete — ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C), plus
      // the TA own-only carve-out via uploadedBy. Null uploadedBy = no owner, TA denied.
      // The TA carve-out covers renames only; student-visibility controls
      // (visibleToStudents / availableAt) require instructor/admin/unit access,
      // matching the UI that hides the visibility eye from TAs.
      const changesVisibility = hasVisibility || hasAvailableAt;
      const isOwnTaEdit =
        access.level === "ta" && material.uploadedBy === user.id && !changesVisibility;
      if (access.rank < 2 && !isOwnTaEdit) {
        return json(403, { error: "Forbidden" });
      }

      const updated = await prisma.courseMaterial.update({
        where: { id: materialId },
        data,
        select: {
          id: true,
          title: true,
          visibleToStudents: true,
          availableAt: true,
        },
      });

      // Distinguish a pure rename from a visibility change so the audit trail
      // stays legible; a combined edit records under MATERIAL_UPDATED.
      const visibilityChanged = hasVisibility || hasAvailableAt;
      const actionCode = !visibilityChanged
        ? "MATERIAL_RENAMED"
        : hasTitle
          ? "MATERIAL_UPDATED"
          : "MATERIAL_VISIBILITY_CHANGED";

      // The audit entry records only the fields this edit actually changed, so a
      // rename does not leave visibility columns in the trail and vice versa.
      const details: MaterialEditAuditDetails = { courseId };
      if (hasTitle) {
        details.previousTitle = material.title;
        details.newTitle = updated.title;
      }
      if (visibilityChanged) {
        details.previousVisibleToStudents = material.visibleToStudents;
        details.newVisibleToStudents = updated.visibleToStudents;
        details.previousAvailableAt = material.availableAt;
        details.newAvailableAt = updated.availableAt;
      }

      const { fireAndForget, logAuditAction } = await import("~/lib/logging.server");
      fireAndForget(
        logAuditAction({
          ...getActorContext(user ?? null),
          ...requestContext,
          actionCode,
          category: "MATERIAL",
          entityType: "CourseMaterial",
          entityId: materialId,
          entityLabel: updated.title,
          details,
        }),
      );

      return json(200, { success: true, material: updated });
    }

    case "DELETE": {
      const materialId = params.materialId;
      if (!materialId) {
        return json(400, { error: "MATERIAL_ID_REQUIRED" });
      }

      const material = await prisma.courseMaterial.findFirst({
        where: { id: materialId, courseId, deletedAt: null },
        select: {
          id: true,
          uploadedBy: true,
          title: true,
          status: true,
          duplicateOfId: true,
        },
      });
      if (!material) {
        return json(404, { error: "MATERIAL_NOT_FOUND" });
      }

      // tas.canManageMaterials is a single gate covering upload AND delete, so
      // an off flag must also block TA deletes (including own uploads).
      if (access.level === "ta" && !(await getPolicy("tas.canManageMaterials"))) {
        return denyByPolicy({
          request,
          policyKey: "tas.canManageMaterials",
          user,
          action: "material.delete",
          courseId,
        });
      }

      // §7: delete is ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C), plus the TA
      // own-only carve-out via uploadedBy (#294). Null uploadedBy = no owner,
      // TA denied.
      const isOwnTa = access.level === "ta" && material.uploadedBy === user.id;

      // #949/#1494 review: a late content-duplicate leaves the uploader a FAILED
      // receipt row that the client reads and then deletes. Students may upload
      // when `students.canUploadMaterials` is on, but rank 0 cannot delete — so
      // without this carve-out every student duplicate leaves a dead receipt in
      // the course's material list, one per retry. Scoped as narrowly as the
      // receipt itself: the caller's own row, FAILED, and pointing at a winner.
      // It grants nothing over real material, which is never FAILED with a
      // `duplicateOfId`.
      const isOwnDuplicateReceipt =
        material.uploadedBy === user.id &&
        material.status === "FAILED" &&
        material.duplicateOfId !== null;

      if (access.rank < 2 && !isOwnTa && !isOwnDuplicateReceipt) {
        return json(403, { error: "Forbidden" });
      }

      // Soft delete: set deletedAt and deletedBy. One-way: never propagated to Canvas.
      await prisma.courseMaterial.update({
        where: { id: materialId },
        data: { deletedAt: new Date(), deletedBy: user.id },
      });

      const { fireAndForget: fireAndForgetDelete, logAuditAction: logAuditActionDelete } =
        await import("~/lib/logging.server");
      fireAndForgetDelete(
        logAuditActionDelete({
          ...getActorContext(user ?? null),
          ...requestContext,
          actionCode: "MATERIAL_DELETED",
          category: "MATERIAL",
          entityType: "CourseMaterial",
          entityId: materialId,
          entityLabel: material.title,
          details: { courseId },
        }),
      );

      return new Response(null, { status: 204 });
    }

    default:
      return json(405, { error: "Method not allowed" });
  }
}

const DUPLICATE_CONTENT_MESSAGE = "A file with identical content already exists in this course";

/**
 * Resolve a `(courseId, pending:<bytehash>)` collision — two uploads of the
 * exact same bytes to the same course.
 *
 * A `pending:` checksum only survives while a row is mid-flight or has died
 * before finalization, so the collision is meaningful rather than incidental:
 *
 *   - still PROCESSING → a genuine concurrent upload of the same file. 409,
 *     which keeps byte-identical re-uploads failing fast exactly as they did
 *     before #949; only content-identical-but-byte-different duplicates became
 *     asynchronous.
 *   - FAILED or soft-deleted → a stranded row from an earlier attempt (failed
 *     extraction, or a process that died mid-run). Reclaim it and retry. This
 *     is the user-driven half of recovery; the sweeper
 *     (`lib/materials/extraction-job.server.ts`) is the automatic half, and
 *     neither depends on the other.
 *
 * The claim is a single conditional `updateMany` rather than a read followed by
 * an unconditional `update` (#1494 review): two identical retries can both read
 * the row as FAILED, and an unconditional update would let both start embedding
 * the same materialId, leaving the final status nondeterministic. Restating the
 * "not already claimed" predicate in the UPDATE's WHERE makes the database
 * serialize them on the row lock — exactly one gets `count === 1` and proceeds,
 * and the loser falls through to the same 409 a live concurrent upload returns.
 */
async function reclaimProvisionalRow(
  courseId: string,
  provisionalChecksum: string,
  userId: string,
  upload: { bytes: Buffer; fileName: string; mimeType: string },
): Promise<{ outcome: "conflict" | "reclaimed"; materialId: string } | null> {
  const existing = await prisma.courseMaterial.findFirst({
    where: { courseId, checksum: provisionalChecksum },
    select: { id: true },
  });
  if (!existing) return null;

  const now = new Date();
  // The claim and the blob replacement commit together (#1494 review). The row
  // is flipped to PROCESSING here and the dead attempt's bytes are replaced with
  // this caller's; if those were two statements, a crash between them would
  // leave a pending row with no blob — invisible to the sweeper, which requires
  // one, and unreachable by retry, since identical bytes answer 409. The row
  // would be stranded with no recovery path at all.
  const claimed = await prisma.$transaction(async (tx) => {
    const result = await tx.courseMaterial.updateMany({
      // Every condition that made this row reclaimable is restated here, not
      // just the status one (#1494 review) — the lookup above and this write are
      // not atomic, so anything read outside the WHERE can change underneath us:
      //
      //   - `checksum` pins the row to the *provisional* state we found it in. A
      //     worker that finalizes between the read and this update replaces the
      //     `pending:` checksum with the real content hash, and without this the
      //     UPDATE would happily match that now-READY row and reset it back to
      //     PROCESSING with a null rawText.
      //   - a PROCESSING row is reclaimable only once its extraction lease has
      //     expired, soft-deleted or not. `deletedAt != null` alone used to be
      //     enough, which let a DELETE issued during processing hand the row to
      //     a second worker while the first was still writing to it.
      //
      // A row that fails these is either live or already finalized; both are the
      // 409 below.
      where: {
        id: existing.id,
        checksum: provisionalChecksum,
        OR: [{ status: { not: "PROCESSING" } }, { extractionLeaseUntil: { lt: now } }],
      },
      data: {
        status: "PROCESSING",
        uploadedBy: userId,
        deletedAt: null,
        deletedBy: null,
        processedAt: null,
        duplicateOfId: null,
        rawText: null,
        // Hand the row back as a fresh job: clear the dead attempt's lease and
        // reset its attempt count, or a row reclaimed after two failures would
        // start one strike from being abandoned by the sweeper.
        extractionLeaseUntil: null,
        extractionAttempts: 0,
      },
    });

    // Only the winner replaces the bytes: a loser's UPDATE matched nothing, and
    // overwriting the blob would corrupt the run the winner is about to start.
    if (result.count > 0) {
      await persistUploadBlob(existing.id, upload.bytes, upload.fileName, upload.mimeType, tx);
    }
    return result;
  });

  if (claimed.count === 0) {
    // Either the row was live PROCESSING all along, or a concurrent retry won
    // the claim a moment ago. Both mean "someone else is already processing
    // these bytes", which is the 409 case.
    return { outcome: "conflict", materialId: existing.id };
  }
  return { outcome: "reclaimed", materialId: existing.id };
}

async function uploadMaterial(
  request: Request,
  courseId: string,
  user: Session["user"],
  requestContext: ReturnType<typeof getRequestContext>,
) {
  let formData: FormData;
  try {
    formData = await readBoundedFormData(request, MATERIAL_UPLOAD_BODY_MAX_BYTES);
  } catch (error) {
    if (error instanceof MultipartBodyTooLargeError) {
      return json(413, { error: "PAYLOAD_TOO_LARGE" });
    }
    if (error instanceof MultipartBodyInvalidError) {
      return json(400, { error: error.message });
    }
    throw error;
  }
  const file = formData.get("file") as File;

  if (!file) {
    return json(400, { error: "No file provided" });
  }

  // Type/size caps and the #225 RAG-05 magic-byte sniff stay inline: they are
  // cheap, and a rejected file must still fail synchronously with a 400 rather
  // than becoming a background FAILED row the caller has to poll for.
  try {
    await validateUploadedFile(file);
  } catch (validationError) {
    return json(400, { error: toMaterialUploadUserMessage(validationError) });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const provisionalChecksum = `${PENDING_CHECKSUM_PREFIX}${createHash("sha256")
    .update(bytes)
    .digest("hex")}`;
  const title = (file.name || "upload").replace(/\.[^/.]+$/, "") || "upload";

  let materialId: string;
  try {
    // The blob is created *with* the row, not after it (#1494 review): the 202
    // promises the upload survives, so "row is PROCESSING" and "bytes exist to
    // re-run from" must never be observable apart. A nested create is one
    // statement — no partially-persisted upload to reason about.
    const created = await prisma.courseMaterial.create({
      data: {
        courseId,
        title,
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size || bytes.length,
        checksum: provisionalChecksum,
        rawText: null,
        status: "PROCESSING",
        uploadedBy: user.id, // #294: owner FK for TA own-only delete (§7)
        uploadBlob: {
          create: {
            bytes: toBytesColumn(bytes),
            fileName: file.name || "upload",
            mimeType: file.type || "application/octet-stream",
          },
        },
      },
    });
    materialId = created.id;
  } catch (createError) {
    if (isChecksumConflict(createError)) {
      const resolution = await reclaimProvisionalRow(
        courseId,
        provisionalChecksum,
        user.id,
        // The reclaimed row's bytes belong to the attempt that died; the claim
        // replaces them with this caller's in the same commit, so a resume
        // always re-runs against what was actually uploaded.
        {
          bytes,
          fileName: file.name || "upload",
          mimeType: file.type || "application/octet-stream",
        },
      );
      if (resolution?.outcome === "conflict") {
        return json(409, {
          error: "This file is already being processed in this course",
          materialId: resolution.materialId,
        });
      }
      if (resolution?.outcome === "reclaimed") {
        materialId = resolution.materialId;
      } else {
        // The colliding row disappeared between the failed insert and the
        // lookup — another request finalized or deleted it. Nothing to reclaim.
        return json(409, {
          error: DUPLICATE_CONTENT_MESSAGE,
        });
      }
    } else {
      console.error("Error persisting material upload:", createError);
      return json(500, { error: toMaterialUploadUserMessage(createError) });
    }
  }

  // Audit the upload as soon as the material row is persisted, independent of
  // extraction and embedding. A material that uploads successfully but later
  // fails to process is still a real upload and must leave an audit trail (the
  // processing failure is recorded separately by `failMaterial`).
  // actorUserId/actorRole come from getActorContext; email/name and the
  // material's type/size go in details so the audit line carries who-added-what.
  const { fireAndForget: fireAndForgetUpload, logAuditAction: logAuditActionUpload } =
    await import("~/lib/logging.server");
  fireAndForgetUpload(
    logAuditActionUpload({
      ...getActorContext(user ?? null),
      ...requestContext,
      actionCode: "MATERIAL_UPLOADED",
      category: "MATERIAL",
      entityType: "CourseMaterial",
      entityId: materialId,
      entityLabel: title,
      details: {
        courseId,
        actorEmail: user.email,
        actorName: user.name,
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size || bytes.length,
      },
    }),
  );

  // Run it here and now for the common case, but the 202 no longer depends on
  // this process surviving: the row is leased and the bytes are persisted, so a
  // crash mid-extraction leaves an expired lease the sweeper picks up.
  startMaterialExtraction(materialId, file, courseId, user.id, requestContext);
  // Cheap after the first call — one guarded interval per process.
  ensureMaterialSweeperRunning(requestContext);

  return json(202, {
    success: true,
    materialId,
    status: "PROCESSING",
    message: "Material accepted and is being processed",
  });
}

const PREVIEW_EXCERPT_MAX = 4000;

/**
 * Column set for every materials LIST response (#948). Deliberately an explicit
 * `select` rather than `include`, so `rawText` — the full extracted document
 * text, which can be megabytes per row — never reaches the JSON payload. The
 * single-material preview path selects `rawText` on its own and truncates it to
 * `PREVIEW_EXCERPT_MAX`; lists have no use for it at all.
 *
 * MAINTENANCE: this is an allow-list. A new column on `CourseMaterial` will NOT
 * appear in list responses until it is added here explicitly — add it (unless
 * it is another large text blob, in which case leave it out on purpose).
 *
 * `_count` is nested inside the select because Prisma rejects `include` and
 * `select` at the same level. Both list paths (the includeDeleted/admin path and
 * the student/staff loader path) share this const so they cannot drift; note
 * that `visibleToStudents`/`availableAt` MUST stay selected — the staff branch
 * destructures them off the row and would emit `undefined` without them.
 */
const MATERIAL_LIST_SELECT = {
  id: true,
  courseId: true,
  title: true,
  mimeType: true,
  fileSize: true,
  checksum: true,
  status: true,
  externalId: true,
  externalSource: true,
  canvasUpdatedAt: true,
  uploadedBy: true,
  visibleToStudents: true,
  availableAt: true,
  deletedAt: true,
  deletedBy: true,
  unpublishedAt: true,
  // #949: how a client polling after a 202 learns its upload resolved to an
  // already-present material instead of a new one.
  duplicateOfId: true,
  createdAt: true,
  updatedAt: true,
  processedAt: true,
  _count: { select: { chunks: true } },
} as const;

async function materialsListResponse(
  courseId: string,
  includeDeleted: boolean,
  cursorParams: { cursor: string | null; limit: number },
) {
  const { cursor, limit } = cursorParams;
  const pageArgs = {
    where: includeDeleted ? { courseId } : { courseId, deletedAt: null },
    select: MATERIAL_LIST_SELECT,
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: limit + 1,
  };
  // A cursor page resumes past the cursor row itself; the first page sends
  // neither key, so Prisma never sees a half-specified pair.
  const rows = cursor
    ? await prisma.courseMaterial.findMany({ ...pageArgs, cursor: { id: cursor }, skip: 1 })
    : await prisma.courseMaterial.findMany(pageArgs);
  const { page, nextCursor } = splitPage(rows, limit);

  return json(200, {
    materials: page.map(({ _count, ...material }) => ({
      ...material,
      chunkCount: _count?.chunks ?? 0,
    })),
    nextCursor,
  });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const courseId = params.courseId;
  const materialId = params.materialId;
  if (!courseId) {
    return json(400, { error: "Course ID is required" });
  }

  const cursorParams = parseCursorParams(new URL(request.url).searchParams);

  // §19 forensics opt-in (#315): ADMIN may pass ?includeDeleted=true to surface
  // soft-deleted materials — including those in a soft-deleted course. The access
  // resolver filters `deletedAt: null` (→ 404 on deleted courses), so ADMIN reads
  // bypass it here, mirroring courses.id.ts. No-op for every non-ADMIN caller.
  const session = await getRequestSession(request);
  if (wantsIncludeDeleted(request, session?.user)) {
    // The access resolver (skipped here) is what 404s a nonexistent course, so
    // check existence explicitly — otherwise an unknown id returns 200 {[]},
    // indistinguishable from "course exists, no materials". Mirrors courses.id.ts.
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true },
    });
    if (!course) {
      return json(404, { error: "COURSE_NOT_FOUND" });
    }
    return materialsListResponse(courseId, true, cursorParams);
  }

  const resolved = await resolveMaterialsAccess(request, courseId);
  if (resolved.response) return resolved.response;
  const { user, access, isPublished } = resolved;

  // §7/§19: students can view materials only in published courses.
  if (access.level === "student" && !isPublished) {
    return json(403, { error: "Forbidden" });
  }

  // Policy gate (students.canViewMaterials, default true): layers on top of the
  // publish gate — off means students cannot list materials at all.
  if (access.level === "student" && !(await getPolicy("students.canViewMaterials"))) {
    return denyByPolicy({
      request,
      policyKey: "students.canViewMaterials",
      user,
      action: "material.list",
      courseId,
    });
  }

  const excludedCanvasFileIds =
    access.level === "student"
      ? (
          await prisma.canvasMaterialExclusion.findMany({
            where: { courseId },
            select: { canvasFileId: true },
          })
        ).map((row) => row.canvasFileId)
      : [];

  const studentGate =
    access.level === "student" ? studentVisibilityWhere(new Date(), excludedCanvasFileIds) : {};

  if (materialId) {
    const material = await prisma.courseMaterial.findFirst({
      where: { id: materialId, courseId, deletedAt: null, ...studentGate },
      select: {
        id: true,
        title: true,
        mimeType: true,
        fileSize: true,
        status: true,
        createdAt: true,
        rawText: true,
      },
    });

    if (!material) {
      // A student-gated miss is ambiguous: either the material doesn't exist
      // (or is soft-deleted) or it exists but studentGate excluded it. Only
      // students can hit the latter case (studentGate is `{}` for staff, so
      // this findFirst is otherwise identical to the existence check below).
      // Distinguish them with one extra query so hidden-but-real material
      // reports 403, matching #1180's spec, instead of the indistinguishable
      // 404 a folded WHERE clause would otherwise produce.
      if (access.level === "student") {
        const exists = await prisma.courseMaterial.findFirst({
          where: { id: materialId, courseId, deletedAt: null },
          select: { id: true },
        });
        if (exists) {
          return json(403, { error: "Forbidden" });
        }
      }
      return json(404, { error: "Material not found" });
    }

    if (material.status !== "READY") {
      return json(409, { error: "Material is not ready for preview" });
    }

    const rawText = material.rawText ?? "";
    const truncated = rawText.length > PREVIEW_EXCERPT_MAX;
    const { rawText: _rawText, ...meta } = material;

    return json(200, {
      material: meta,
      excerpt: truncated ? rawText.slice(0, PREVIEW_EXCERPT_MAX) : rawText,
      truncated,
    });
  }

  const { cursor, limit } = cursorParams;
  const pageArgs = {
    where: { courseId, deletedAt: null, ...studentGate },
    select: MATERIAL_LIST_SELECT,
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: limit + 1,
  };
  // A cursor page resumes past the cursor row itself; the first page sends
  // neither key, so Prisma never sees a half-specified pair.
  const rows = cursor
    ? await prisma.courseMaterial.findMany({ ...pageArgs, cursor: { id: cursor }, skip: 1 })
    : await prisma.courseMaterial.findMany(pageArgs);
  const { page, nextCursor } = splitPage(rows, limit);

  // Staff receive the scheduling fields so the management UI can render and edit
  // them; students never do (they only ever see already-visible materials).
  const staff = isStaffAccess(access);
  return json(200, {
    materials: page.map(({ _count, visibleToStudents, availableAt, ...material }) => {
      const row = { ...material, chunkCount: _count?.chunks ?? 0 };
      if (!staff) return row;
      return { ...row, visibleToStudents, availableAt };
    }),
    nextCursor,
  });
}
