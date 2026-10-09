import type { JsonObject } from "~/lib/json-value";
import { useState, useCallback, useEffect, useRef } from "react";
import { Link, redirect, useLoaderData, useRevalidator } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import prisma from "~/lib/prisma.server";
import { CoreAppShell } from "~/components/layout/core-app-shell";
import {
  CourseDetailManagerView,
  type CourseDetailManagerCourse,
} from "~/components/courses/course-detail-manager-view";
import { CourseDetailTaView } from "~/components/courses/course-detail-ta-view";
import { CourseDetailStudentView } from "~/components/courses/course-detail-student-view";
import { useCourseTopics } from "~/hooks/api/use-course-topics";
import { useCourseEnrollments } from "~/hooks/api/use-course-enrollments";
import { useCourseMaterials } from "~/hooks/api/use-course-materials";
import type {
  CourseMaterial as CourseMaterialRow,
  UploadOutcome,
} from "~/hooks/api/use-course-materials";
import { useCourseTAs } from "~/hooks/api/use-course-tas";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@eduai/ui";
import { CourseSwitcher } from "~/components/layout/course-switcher";
import type {
  CourseMaterial as UploadMaterial,
  UploadItem,
} from "~/components/course-materials-upload";
import type { CourseDetail } from "~/hooks/api/use-course-detail";
import { resolveCourseAccess } from "~/lib/rbac/resolve-course-access.server";
import type { RbacUser } from "~/lib/rbac";
import { COURSE_STAFF_SELECT, serializeCourseForApi } from "~/lib/courses/dto.server";
import { getCourseInstructors } from "~/lib/courses/instructors.server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { notFound } from "~/lib/not-found.server";
import { describeUploadFailure } from "~/lib/material-failure-notice";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);
  if (!session?.user) return redirect("/auth/login");

  const courseId = params.courseId;
  if (!courseId) throw notFound(session.user);

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: COURSE_STAFF_SELECT,
  });

  if (!course) throw notFound(session.user);

  const user = session.user;
  let authorizedUnits: string[] = [];
  if (user.role === "UNIT_ADMIN") {
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { authorizedUnits: true },
    });
    authorizedUnits = dbUser?.authorizedUnits ?? [];
  }
  const rbacUser: RbacUser = {
    id: user.id,
    role: user.role as RbacUser["role"],
    authorizedUnits,
  };

  const access = await resolveCourseAccess(rbacUser, {
    id: course.id,
    instructorId: course.instructorId,
    department: course.department,
  });

  // No access at all — the same 404 as a missing course, so the page never
  // confirms the course exists (e.g. TA opened a course they do not assist).
  if (!access) throw notFound(user);

  // Students cannot view unpublished courses by direct URL — also a 404.
  if (access === "student" && !course.isPublished) throw notFound(user);

  // Managing course staff is ADMIN/UNIT_ADMIN only.
  const canManageStaff = access === "admin" || access === "unit";

  // TA/student/instructor candidates are not preloaded here (#1042) — the
  // platform-wide lists grow unbounded with total user count. Candidates are
  // searched on demand through the bounded, paginated users API.
  //
  // #1840: what IS loaded is the course's own instructors — every active
  // INSTRUCTOR enrollment, not the single `Course.instructorId`. A course may
  // have several, and the staff tab has to list all of them to offer a
  // per-instructor remove. Bounded by the course's own staff count, and add/
  // remove revalidate this loader rather than keeping a second client cache.
  const courseInstructors = canManageStaff
    ? (
        await prisma.enrollment.findMany({
          where: { courseId, role: "INSTRUCTOR", isActive: true },
          select: {
            id: true,
            userId: true,
            user: { select: { name: true, email: true, role: true } },
          },
          orderBy: [{ enrolledAt: "asc" }, { id: "asc" }],
        })
      ).map((row) => ({
        enrollmentId: row.id,
        id: row.userId,
        name: row.user.name,
        email: row.user.email,
        platformRole: row.user.role,
        isPrimary: row.userId === course.instructorId,
      }))
    : [];

  const isStudent = access === "student";

  const audience = isStudent ? "student" : "staff";

  // #1841: every active instructor, so the detail header stops rendering one of
  // three. The serializer redacts their emails for the student audience.
  const instructorSummaries = (await getCourseInstructors([course.id])).get(course.id) ?? [];

  return {
    // SAFETY: the serializer adds audience-specific fields on top of the
    // detail shape; `JsonObject` names those extras as what they are — JSON
    // the client renders — rather than reopening the whole course.
    course: serializeCourseForApi(course, {
      audience,
      detail: true,
      instructors: instructorSummaries,
    }) as CourseDetail & JsonObject,
    // TA roster is loaded client-side via useCourseTAs (TA = Enrollment
    // role=TA); the course query no longer includes a CourseTA relation.
    user,
    access,
    courseInstructors,
  };
}

/**
 * Narrow a materials-list row to the shape the upload/manager list draws.
 *
 * #1749: `duplicateOfId` and `hasExtractedText` are the only two fields the
 * failure popover has to tell "already on the course" and "we read it but
 * couldn't index it" apart from "we couldn't read it" — and they are what
 * decides whether **Try again** is offered at all. Dropping them here made
 * every FAILED row fall through to the unreadable-file copy with no retry,
 * which is the one outcome the instructor cannot act on. Both stay optional:
 * the list only resolves them for FAILED rows.
 */
export function toUploadMaterial(m: CourseMaterialRow): UploadMaterial {
  return {
    id: m.id,
    title: m.title,
    mimeType: m.mimeType,
    fileSize: m.fileSize,
    status: m.status,
    createdAt: m.createdAt,
    chunkCount: m.chunkCount,
    uploadedBy: m.uploadedBy ?? null,
    visibleToStudents: m.visibleToStudents,
    availableAt: m.availableAt ?? null,
    duplicateOfId: m.duplicateOfId ?? null,
    hasExtractedText: m.hasExtractedText,
    failureCode: m.failureCode ?? null,
  };
}

type UploadResult = Omit<UploadItem, "name">;

/** Files in flight at once during a batch upload; each also polls until it settles. */
const UPLOAD_CONCURRENCY = 3;

const UPLOAD_READY_MESSAGE = "Material uploaded and processed successfully";
const UPLOAD_PROCESSING_MESSAGE =
  "Upload accepted. Processing is taking a while — the list will update when it finishes.";

export default function CourseDetailPage() {
  const { course, user, access, courseInstructors } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const {
    topics,
    createTopic,
    deleteTopic,
    editTopic,
    refetch: refetchTopics,
  } = useCourseTopics(course.id);
  const {
    enrollments,
    loading: enrollmentsLoading,
    error: enrollmentsError,
    total: enrollmentsTotal,
    hasMore: hasMoreEnrollments,
    loadingMore: enrollmentsLoadingMore,
    loadMore: loadMoreEnrollments,
    enroll,
    removeEnrollment,
    refetch: refetchEnrollments,
  } = useCourseEnrollments(
    course.id,
    access === "admin" || access === "unit" || access === "instructor",
  );
  const {
    materials,
    uploadMaterial,
    deleteMaterial,
    reprocessMaterial,
    hasMore: hasMoreMaterials,
    loadingMore: materialsLoadingMore,
    loadMore: loadMoreMaterials,
    refetch: refetchMaterials,
  } = useCourseMaterials(course.id);
  const { tas, addTA, removeTA } = useCourseTAs(course.id);
  const [isUploading, setIsUploading] = useState(false);
  const [materialsError, setMaterialsError] = useState<string | null>(null);
  const [materialsSuccess, setMaterialsSuccess] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  // Read by a batch long after the render that started it (#1748 review): the
  // course switcher keeps this page mounted, so `course.id` and `materials`
  // in that render's closure go stale while the batch is still running.
  // `courseVisitRef` counts course changes rather than holding the id, so a
  // batch from course A stays stale even after the user switches back to A.
  const courseVisitRef = useRef(0);
  const materialsRef = useRef(materials);
  useEffect(() => {
    materialsRef.current = materials;
  }, [materials]);

  // A batch started on the previous course keeps uploading there, but its
  // progress and summary belong to that course, not this one.
  useEffect(() => {
    courseVisitRef.current += 1;
    setIsUploading(false);
    setMaterialsError(null);
    setMaterialsSuccess(null);
    setUploads([]);
  }, [course.id]);

  /**
   * Forget the last batch as the upload dialog reopens (#1748 review), so the
   * instructor sees an idle drop zone rather than the previous batch's list,
   * which read as files about to be uploaded again. A batch still running
   * keeps its progress.
   */
  const clearUploadFeedback = useCallback(() => {
    if (isUploading) return;
    setMaterialsError(null);
    setMaterialsSuccess(null);
    setUploads([]);
  }, [isUploading]);

  /**
   * #1840: add an instructor WITHOUT touching anyone else's enrollment. This is
   * the plain enrollments POST — `addEnrollment` creates an additional active
   * INSTRUCTOR row and leaves `Course.instructorId` and every other enrollment
   * alone. Contrast `handleSetPrimaryInstructor` below, which only moves the
   * course-head column.
   */
  const handleAddInstructor = useCallback(
    async (userId: string) => {
      const res = await fetch(`/api/courses/${course.id}/enrollments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: "INSTRUCTOR" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ADD_INSTRUCTOR_FAILED");
      }
      revalidator.revalidate();
      await refetchEnrollments();
    },
    [course.id, revalidator, refetchEnrollments],
  );

  /**
   * Remove one instructor. The server enforces the instructor floor, so the
   * last one comes back as `409 INSTRUCTOR_FLOOR_VIOLATION`; the error code is
   * passed through verbatim so the view can render a specific message instead
   * of a generic failure.
   */
  const handleRemoveInstructor = useCallback(
    async (enrollmentId: string) => {
      const res = await fetch(`/api/courses/${course.id}/enrollments/${enrollmentId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "REMOVE_INSTRUCTOR_FAILED");
      }
      revalidator.revalidate();
      await refetchEnrollments();
    },
    [course.id, revalidator, refetchEnrollments],
  );

  /** #1939: publish or unpublish from the course page; the endpoint enforces who may. */
  const handlePublishChange = useCallback(
    async (publish: boolean) => {
      const res = await fetch(`/api/courses/${course.id}/${publish ? "publish" : "unpublish"}`, {
        method: "PATCH",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "COURSE_PUBLISH_FAILED");
      }
      revalidator.revalidate();
    },
    [course.id, revalidator],
  );

  /**
   * Name the course head. Since #1840 this PATCH no longer deactivates the
   * previous instructor — it only moves `Course.instructorId` (and enrolls the
   * new head if they were not already an instructor).
   */
  const handleSetPrimaryInstructor = useCallback(
    async (instructorId: string) => {
      const res = await fetch(`/api/courses/${course.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructorId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "SET_PRIMARY_INSTRUCTOR_FAILED");
      }
      revalidator.revalidate();
      await refetchEnrollments();
    },
    [course.id, revalidator, refetchEnrollments],
  );

  const handleEnrollStudent = useCallback(
    async (userId: string) => {
      await enroll(userId, "STUDENT");
    },
    [enroll],
  );

  const handleRemoveEnrollment = useCallback(
    async (enrollmentId: string) => {
      await removeEnrollment(enrollmentId);
    },
    [removeEnrollment],
  );

  const uploadMaterials: UploadMaterial[] = materials.map(toUploadMaterial);

  /**
   * One file's outcome in the words the instructor reads. `batchNames` maps the
   * material ids of this batch's own files to their names, so a duplicate of a
   * sibling says so instead of pointing at an older material.
   */
  const describeUpload = (
    outcome: UploadOutcome,
    batchNames: Map<string, string>,
  ): UploadResult => {
    switch (outcome.status) {
      case "ready":
      // #1791: this upload is why the material is on the course, so a restore is
      // reported as added, not as "already exists".
      case "restored":
        return { status: "ready" };
      case "duplicate": {
        const sibling = batchNames.get(outcome.duplicateOfId);
        if (sibling) {
          return {
            status: "duplicate",
            message: `Identical to "${sibling}" in this batch — nothing was added`,
          };
        }
        const existing = materialsRef.current.find((m) => m.id === outcome.duplicateOfId);
        return {
          status: "duplicate",
          message: existing
            ? `"${existing.title}" already contains identical content — nothing was added`
            : "A file with identical content already exists in this course",
        };
      }
      // The full explanation and Try again (#1791) live on the settled row's
      // failure popover; the alert names the reason and points there (#1931).
      case "failed":
        return {
          status: "failed",
          message: describeUploadFailure(outcome.failureCode),
        };
      case "processing":
        return { status: "processing" };
    }
  };

  /**
   * Batch upload (#1748). The endpoint still takes one file per request, so a
   * batch is a small worker pool over `uploadMaterial`: each file keeps its own
   * validation, duplicate check and outcome, and one bad file never sinks the rest.
   */
  const handleFilesSelect = async (files: File[]) => {
    if (files.length === 0) return;
    const visit = courseVisitRef.current;
    // Once the user switches course the batch keeps uploading to this one, but
    // stops writing into page state that now belongs to the other.
    const isCurrent = () => courseVisitRef.current === visit;
    setIsUploading(true);
    try {
      setMaterialsError(null);
      setMaterialsSuccess(null);

      const results: UploadItem[] = files.map((f) => ({ name: f.name, status: "queued" }));
      const batchNames = new Map<string, string>();
      setUploads([...results]);
      const settle = (i: number, item: UploadResult) => {
        results[i] = { ...item, name: files[i].name };
        if (isCurrent()) setUploads([...results]);
      };

      let next = 0;
      const worker = async () => {
        while (next < files.length) {
          const i = next++;
          settle(i, { status: "uploading" });
          try {
            // The upload endpoint returns 202 and processes in the background (#949),
            // so the outcome arrives from polling rather than from the POST status.
            const outcome = await uploadMaterial(files[i], {
              onAccepted: (id) => batchNames.set(id, files[i].name),
            });
            settle(i, describeUpload(outcome, batchNames));
          } catch (e) {
            settle(i, {
              status: "failed",
              message: e instanceof Error ? e.message : "Upload failed",
            });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, worker));
      if (!isCurrent()) return;

      if (files.length === 1) {
        const [only] = results;
        if (only.message) setMaterialsError(only.message);
        else
          setMaterialsSuccess(
            only.status === "processing" ? UPLOAD_PROCESSING_MESSAGE : UPLOAD_READY_MESSAGE,
          );
      } else {
        const rejected = results.filter((r) => r.status === "failed" || r.status === "duplicate");
        const stillProcessing = results.some((r) => r.status === "processing");
        if (rejected.length > 0) {
          setMaterialsError(
            `${rejected.length} of ${files.length} files couldn't be added — see the list below.`,
          );
        } else if (stillProcessing) {
          setMaterialsSuccess(
            `All ${files.length} files accepted. Some are still processing — the list will update when they finish.`,
          );
        } else {
          setMaterialsSuccess(`All ${files.length} files uploaded and processed successfully`);
        }
      }
    } finally {
      if (isCurrent()) setIsUploading(false);
    }
  };

  return (
    <CoreAppShell
      user={user}
      title={course.name}
      breadcrumbs={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/dashboard">Home</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/courses">Courses</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <CourseSwitcher
                currentCourseId={course.id}
                currentCourseCode={course.code}
                currentCourseName={course.name}
              />
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      <div className="flex flex-1 flex-col">
        <div className="px-4 lg:px-6 py-6">
          {access === "admin" || access === "unit" || access === "instructor" ? (
            <CourseDetailManagerView
              // The staff branch above always includes this non-null DB field.
              course={course as CourseDetailManagerCourse}
              access={access}
              topics={topics}
              enrollments={enrollments}
              enrollmentsLoading={enrollmentsLoading}
              enrollmentsError={enrollmentsError}
              enrollmentsTotal={enrollmentsTotal}
              hasMoreEnrollments={hasMoreEnrollments}
              enrollmentsLoadingMore={enrollmentsLoadingMore}
              onLoadMoreEnrollments={loadMoreEnrollments}
              materials={uploadMaterials}
              hasMoreMaterials={hasMoreMaterials}
              materialsLoadingMore={materialsLoadingMore}
              onLoadMoreMaterials={loadMoreMaterials}
              tas={tas}
              courseInstructors={courseInstructors}
              onEnrollStudent={handleEnrollStudent}
              onRemoveEnrollment={handleRemoveEnrollment}
              onRefreshEnrollments={refetchEnrollments}
              isUploading={isUploading}
              materialsError={materialsError}
              materialsSuccess={materialsSuccess}
              uploads={uploads}
              onFilesSelect={handleFilesSelect}
              onUploadDialogOpen={clearUploadFeedback}
              onCreateTopic={async (name) => {
                await createTopic(name);
              }}
              onDeleteTopic={async (id) => {
                await deleteTopic(id);
              }}
              onRenameTopic={async (id, name) => {
                await editTopic(id, name);
              }}
              onRefreshTopics={refetchTopics}
              onAddInstructor={handleAddInstructor}
              onRemoveInstructor={handleRemoveInstructor}
              onSetPrimaryInstructor={handleSetPrimaryInstructor}
              onAddTA={addTA}
              onRemoveTA={removeTA}
              onRefreshMaterials={refetchMaterials}
              onDeleteMaterial={deleteMaterial}
              onReprocessMaterial={reprocessMaterial}
              onPublishChange={handlePublishChange}
              courseId={course.id}
              currentUserId={user.id}
              showCanvasMaterialSync={
                access === "instructor" &&
                course.externalSource === "canvas" &&
                Boolean(course.externalId)
              }
              onMaterialsRefresh={() => void refetchMaterials()}
            />
          ) : access === "ta" ? (
            <CourseDetailTaView
              course={course}
              topics={topics}
              materials={uploadMaterials}
              hasMoreMaterials={hasMoreMaterials}
              materialsLoadingMore={materialsLoadingMore}
              onLoadMoreMaterials={loadMoreMaterials}
              isUploading={isUploading}
              materialsError={materialsError}
              materialsSuccess={materialsSuccess}
              uploads={uploads}
              onFilesSelect={handleFilesSelect}
              onUploadDialogOpen={clearUploadFeedback}
              courseId={course.id}
              currentUserId={user.id}
              onRefreshMaterials={refetchMaterials}
              onDeleteMaterial={deleteMaterial}
              tas={tas}
              onCreateTopic={async (name) => {
                await createTopic(name);
              }}
              onDeleteTopic={async (id) => {
                await deleteTopic(id);
              }}
            />
          ) : (
            <CourseDetailStudentView
              course={course}
              materials={uploadMaterials}
              hasMoreMaterials={hasMoreMaterials}
              materialsLoadingMore={materialsLoadingMore}
              onLoadMoreMaterials={loadMoreMaterials}
              topics={topics}
              tas={tas}
              isUploading={isUploading}
              materialsError={materialsError}
              materialsSuccess={materialsSuccess}
              uploads={uploads}
              onFilesSelect={handleFilesSelect}
            />
          )}
        </div>
      </div>
    </CoreAppShell>
  );
}

export { RouteErrorState as ErrorBoundary } from "~/components/shared/route-error-state";
