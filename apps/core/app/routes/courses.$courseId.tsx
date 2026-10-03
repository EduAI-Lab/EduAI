import type { JsonObject } from "~/lib/json-value";
import { useState, useCallback } from "react";
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
import type { CourseMaterial as CourseMaterialRow } from "~/hooks/api/use-course-materials";
import { useCourseTAs } from "~/hooks/api/use-course-tas";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@eduai/ui";
import { CourseSwitcher } from "~/components/layout/course-switcher";
import type { CourseMaterial as UploadMaterial } from "~/components/course-materials-upload";
import type { CourseDetail } from "~/hooks/api/use-course-detail";
import { resolveCourseAccess } from "~/lib/rbac/resolve-course-access.server";
import type { RbacUser } from "~/lib/rbac";
import { COURSE_STAFF_SELECT, serializeCourseForApi } from "~/lib/courses/dto.server";
import { getCourseInstructors } from "~/lib/courses/instructors.server";
import { getRequestSession } from "~/lib/auth/request-session.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);
  if (!session?.user) return redirect("/auth/login");

  const courseId = params.courseId;
  if (!courseId) return redirect("/courses");

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: COURSE_STAFF_SELECT,
  });

  if (!course) return redirect("/courses");

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

  // No access at all — redirect (e.g. TA opened a course they do not assist)
  if (!access) return redirect("/courses?access=denied");

  // Students cannot view unpublished courses by direct URL
  if (access === "student" && !course.isPublished) return redirect("/courses?access=unpublished");

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

  const handleFileSelect = useCallback(
    async (file: File) => {
      setIsUploading(true);
      setMaterialsError(null);
      setMaterialsSuccess(null);
      try {
        // The upload endpoint returns 202 and processes in the background (#949),
        // so the outcome arrives from polling rather than from the POST status.
        const outcome = await uploadMaterial(file);
        switch (outcome.status) {
          case "ready":
            setMaterialsSuccess("Material uploaded and processed successfully");
            break;
          case "restored":
            // #1791: this upload is why the material is on the course, so it is
            // reported as a success. Saying "already exists" here is what made
            // a successful retry look like another refusal.
            setMaterialsSuccess("Material processed successfully and is ready to use");
            break;
          case "duplicate": {
            const existing = materials.find((m) => m.id === outcome.duplicateOfId);
            setMaterialsError(
              existing
                ? `"${existing.title}" already contains identical content — nothing was added`
                : "A file with identical content already exists in this course",
            );
            break;
          }
          case "failed":
            // The specific reason (#1791) shows on the settled row in the
            // materials list, via its failure popover and "Try again" — the
            // reprocess-based retry (#1749/#1795), not a re-upload of this file.
            setMaterialsError("Processing failed for this file. Please try again.");
            break;
          case "processing":
            setMaterialsSuccess(
              "Upload accepted. Processing is taking a while — the list will update when it finishes.",
            );
            break;
        }
      } catch (e) {
        setMaterialsError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setIsUploading(false);
      }
    },
    [uploadMaterial, materials],
  );

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
              onFileSelect={handleFileSelect}
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
              onFileSelect={handleFileSelect}
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
              onFileSelect={handleFileSelect}
            />
          )}
        </div>
      </div>
    </CoreAppShell>
  );
}
