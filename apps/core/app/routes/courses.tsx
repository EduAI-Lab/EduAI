import { useState } from "react";
import { Link, redirect, useLoaderData } from "react-router";
import { toast } from "sonner";
import type { LoaderFunctionArgs } from "react-router";

import prisma from "~/lib/prisma.server";
import { CoreAppShell } from "~/components/layout/core-app-shell";
import { CoursesView, type CoursesRole } from "~/components/courses/courses-view";
import { CourseDuplicateError, useCourses } from "~/hooks/api/use-courses";
import type {
  CourseFilterKey,
  CreateCourseInput,
  DuplicateResolution,
} from "~/hooks/api/use-courses";
import { DuplicateCourseDialog } from "~/components/courses/duplicate-course-dialog";
import { TablePagination } from "~/components/ui/table-pagination";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  ConfirmDialog,
} from "@eduai/ui";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { INSTRUCTOR_CANDIDATE_ROLES } from "~/lib/rbac/instructor-candidates";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);
  if (!session?.user) return redirect("/auth/login");

  // These three reads are independent — run them in parallel instead of serially.
  //  - authorizedUnits: read directly from DB (Better Auth session may not include
  //    custom array fields reliably across all environments); UNIT_ADMIN only.
  //  - instructors: for course-creation forms; ADMIN and UNIT_ADMIN only. Any
  //    staff account can be picked, not just platform-role INSTRUCTOR (#1840).
  //  - enrollmentRows: scope the list to enrollment assignments (#499) — never
  //    hardcode course ids; read active Enrollment rows and split by role (§5 list
  //    gate). A TA is an Enrollment with role=TA; STUDENT-platform users may hold
  //    both TA and STUDENT enrollments, so we split by enrollment role.
  const isUnitAdmin = session.user.role === "UNIT_ADMIN";
  const canListInstructors = session.user.role === "ADMIN" || isUnitAdmin;
  const [dbUser, instructors, enrollmentRows] = await Promise.all([
    isUnitAdmin
      ? prisma.user.findUnique({
          where: { id: session.user.id },
          select: { authorizedUnits: true },
        })
      : Promise.resolve(null),
    canListInstructors
      ? prisma.user.findMany({
          where: { role: { in: [...INSTRUCTOR_CANDIDATE_ROLES] }, isActive: true },
          select: { id: true, name: true, email: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string | null; email: string }[]),
    prisma.enrollment.findMany({
      where: { userId: session.user.id, isActive: true },
      select: { courseId: true, role: true },
    }),
  ]);
  const authorizedUnits = dbUser?.authorizedUnits ?? [];
  const taCourseIds = enrollmentRows.filter((r) => r.role === "TA").map((r) => r.courseId);
  const instructorCourseIds = enrollmentRows
    .filter((r) => r.role === "INSTRUCTOR")
    .map((r) => r.courseId);
  const enrolledCourseIds = enrollmentRows
    .filter((r) => r.role === "STUDENT")
    .map((r) => r.courseId);

  return {
    user: session.user,
    authorizedUnits,
    taCourseIds,
    instructorCourseIds,
    enrolledCourseIds,
    instructors,
  };
}

export default function CoursesPage() {
  const {
    user,
    authorizedUnits,
    taCourseIds,
    instructorCourseIds,
    enrolledCourseIds,
    instructors,
  } = useLoaderData<typeof loader>();
  const {
    courses,
    total: courseTotal,
    pagination,
    setPagination,
    search,
    setSearch,
    selectedFilters,
    setFilter,
    clearFilters,
    availableValues,
    loading,
    createCourse,
    updateCourse,
    deleteCourse,
  } = useCourses();

  const handleFilterChange = (groupId: string, values: string[]) => {
    setFilter(groupId as CourseFilterKey, values);
  };

  const handleClearAll = () => {
    setSearch("");
    clearFilters();
  };

  const isAdmin = user.role === "ADMIN";
  const isUnitAdmin = user.role === "UNIT_ADMIN";
  const isInstructor = user.role === "INSTRUCTOR";
  // TA is a course-level enrollment role, not a platform role (#499).
  const isTA = taCourseIds.length > 0;

  // Effective role drives which config/branch of the single CoursesView renders
  // (#1087 Group A) — order matters and mirrors the old ternary dispatch.
  const effectiveRole: CoursesRole = isAdmin
    ? "admin"
    : isUnitAdmin
      ? "unit-admin"
      : isInstructor
        ? "instructor"
        : "mixed";

  const [pendingPublish, setPendingPublish] = useState<{
    id: string;
    publish: boolean;
    label: string;
  } | null>(null);

  // #1811: a duplicate warning holds the create form's promise open until the
  // user restores, creates anyway (resolve → form closes) or cancels (reject → form stays).
  const [duplicate, setDuplicate] = useState<{
    input: CreateCourseInput;
    warning: CourseDuplicateError;
    resolve: () => void;
    reject: (reason: Error) => void;
  } | null>(null);

  const handleCreateCourse = async (data: CreateCourseInput) => {
    try {
      await createCourse(data);
    } catch (error) {
      if (error instanceof CourseDuplicateError) {
        return new Promise<void>((resolve, reject) =>
          setDuplicate({ input: data, warning: error, resolve, reject }),
        );
      }
      toast.error(error instanceof Error ? error.message : "Failed to create course.");
      throw error;
    }
  };

  const handleResolveDuplicate = async (resolution: DuplicateResolution) => {
    if (!duplicate) return;
    try {
      await createCourse(duplicate.input, resolution);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create course.";
      toast.error(message);
      duplicate.reject(error instanceof Error ? error : new Error(message));
      setDuplicate(null);
      return;
    }
    toast.success(
      resolution.duplicateResolution === "restore" ? "Course restored." : "Course created.",
    );
    duplicate.resolve();
    setDuplicate(null);
  };

  const handleCancelDuplicate = () => {
    duplicate?.reject(new Error("Course creation cancelled"));
    setDuplicate(null);
  };

  const handlePublishToggle = async (id: string, publish: boolean) => {
    try {
      await updateCourse(id, { isPublished: publish });
    } catch {
      toast.error("Failed to update course. Please try again.");
    }
  };

  const handlePublishToggleRequest = (id: string, publish: boolean) => {
    const course = courses.find((c) => c.id === id);
    setPendingPublish({
      id,
      publish,
      label: `${course?.code ?? ""} — ${course?.name ?? ""}`.trim(),
    });
    return Promise.resolve();
  };

  // `loading` is only true for the genuine first load (the hook never flips it
  // back on for background refreshes), but gate on "no rows yet" too so a
  // refetch can never tear down an already-mounted page.
  if (loading && courses.length === 0) {
    return (
      <Layout user={user}>
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          Loading courses...
        </div>
      </Layout>
    );
  }

  return (
    <Layout user={user}>
      <div className="px-4 lg:px-6">
        {effectiveRole === "admin" ? (
          <CoursesView
            role="admin"
            courses={courses}
            instructors={instructors}
            search={search}
            onSearchChange={setSearch}
            selectedFilters={selectedFilters}
            onFilterChange={handleFilterChange}
            availableValues={availableValues}
            total={courseTotal}
            onClearAll={handleClearAll}
            onCreateCourse={handleCreateCourse}
            onEditCourse={async (id, data) => {
              await updateCourse(id, data);
            }}
            onDeleteCourse={async (id) => {
              await deleteCourse(id);
            }}
            onPublishToggle={handlePublishToggleRequest}
          />
        ) : effectiveRole === "unit-admin" ? (
          <CoursesView
            role="unit-admin"
            // `/api/courses` already scopes UNIT_ADMIN to their authorized units
            // server-side (#1041). Re-filtering the loaded page here would
            // silently drop rows that belong to the caller but happen to sit on
            // another page, so pass the server's list through unchanged.
            courses={courses}
            authorizedUnits={authorizedUnits}
            instructors={instructors}
            search={search}
            onSearchChange={setSearch}
            selectedFilters={selectedFilters}
            onFilterChange={handleFilterChange}
            availableValues={availableValues}
            total={courseTotal}
            onClearAll={handleClearAll}
            onCreateCourse={handleCreateCourse}
            onEditCourse={async (id, data) => {
              await updateCourse(id, data);
            }}
            onDeleteCourse={async (id) => {
              await deleteCourse(id);
            }}
            onPublishToggle={handlePublishToggleRequest}
          />
        ) : effectiveRole === "instructor" ? (
          <CoursesView
            role="instructor"
            courses={courses}
            search={search}
            onSearchChange={setSearch}
            selectedFilters={selectedFilters}
            onFilterChange={handleFilterChange}
            availableValues={availableValues}
            total={courseTotal}
            onClearAll={handleClearAll}
            onCreateCourse={handleCreateCourse}
            onEditCourse={async (id, data) => {
              await updateCourse(id, data);
            }}
            onDeleteCourse={async (id) => {
              await deleteCourse(id);
            }}
            onPublishToggle={handlePublishToggleRequest}
          />
        ) : (
          <CoursesView
            role="mixed"
            courses={courses}
            taCourseIds={taCourseIds}
            instructorCourseIds={instructorCourseIds}
            enrolledCourseIds={enrolledCourseIds}
            search={search}
            onSearchChange={setSearch}
            selectedFilters={selectedFilters}
            onFilterChange={handleFilterChange}
            availableValues={availableValues}
            total={courseTotal}
            onClearAll={handleClearAll}
          />
        )}
        <div className="mt-4">
          <TablePagination
            pagination={pagination}
            onPaginationChange={setPagination}
            total={courseTotal}
          />
        </div>
      </div>
      <DuplicateCourseDialog
        warning={duplicate?.warning ?? null}
        onResolve={handleResolveDuplicate}
        onCancel={handleCancelDuplicate}
      />
      <ConfirmDialog
        open={pendingPublish !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPublish(null);
        }}
        title={
          pendingPublish
            ? pendingPublish.publish
              ? `Publish "${pendingPublish.label}"?`
              : `Unpublish "${pendingPublish.label}"?`
            : ""
        }
        description={
          pendingPublish
            ? pendingPublish.publish
              ? "Students will be able to see this course."
              : "Students will lose access to this course."
            : ""
        }
        confirmLabel={pendingPublish?.publish ? "Publish" : "Unpublish"}
        variant={pendingPublish?.publish ? "default" : "destructive"}
        onConfirm={() => {
          if (!pendingPublish) return;
          void handlePublishToggle(pendingPublish.id, pendingPublish.publish);
          setPendingPublish(null);
        }}
      />
    </Layout>
  );
}

function Layout({ user, children }: { user: any; children: React.ReactNode }) {
  return (
    <CoreAppShell
      user={user}
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
              <BreadcrumbPage>Courses</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">{children}</div>
        </div>
      </div>
    </CoreAppShell>
  );
}
