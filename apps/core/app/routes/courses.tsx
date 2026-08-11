import { useState } from 'react'
import { Link, redirect, useLoaderData, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import type { LoaderFunctionArgs } from 'react-router'

import { auth } from '~/lib/auth/server'
import prisma from '~/lib/prisma.server'
import { CoreAppShell } from '~/components/layout/core-app-shell'
import { CoursesView, type CoursesRole } from '~/components/courses/courses-view'
import { useCourses } from '~/hooks/api/use-courses'
import { TablePagination } from '~/components/ui/table-pagination'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  ConfirmDialog,
} from '@eduai/ui'

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return redirect('/auth/login')

  // These three reads are independent — run them in parallel instead of serially.
  //  - authorizedUnits: read directly from DB (Better Auth session may not include
  //    custom array fields reliably across all environments); UNIT_ADMIN only.
  //  - instructors: for course-creation forms; ADMIN and UNIT_ADMIN only.
  //  - enrollmentRows: scope the list to enrollment assignments (#499) — never
  //    hardcode course ids; read active Enrollment rows and split by role (§5 list
  //    gate). A TA is an Enrollment with role=TA; STUDENT-platform users may hold
  //    both TA and STUDENT enrollments, so we split by enrollment role.
  const isUnitAdmin = session.user.role === 'UNIT_ADMIN'
  const canListInstructors = session.user.role === 'ADMIN' || isUnitAdmin
  const [dbUser, instructors, enrollmentRows] = await Promise.all([
    isUnitAdmin
      ? prisma.user.findUnique({
          where: { id: session.user.id },
          select: { authorizedUnits: true },
        })
      : Promise.resolve(null),
    canListInstructors
      ? prisma.user.findMany({
          where: { role: 'INSTRUCTOR', isActive: true },
          select: { id: true, name: true, email: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([] as { id: string; name: string | null; email: string }[]),
    prisma.enrollment.findMany({
      where: { userId: session.user.id, isActive: true },
      select: { courseId: true, role: true },
    }),
  ])
  const authorizedUnits = dbUser?.authorizedUnits ?? []
  const taCourseIds = enrollmentRows
    .filter((r) => r.role === 'TA')
    .map((r) => r.courseId)
  const enrolledCourseIds = enrollmentRows
    .filter((r) => r.role === 'STUDENT')
    .map((r) => r.courseId)

  return { user: session.user, authorizedUnits, taCourseIds, enrolledCourseIds, instructors }
}

export default function CoursesPage() {
  const { user, authorizedUnits, taCourseIds, enrolledCourseIds, instructors } = useLoaderData<typeof loader>()
  const [searchParams, setSearchParams] = useSearchParams()
  const accessDenied = searchParams.get('access') === 'denied'
  const accessUnpublished = searchParams.get('access') === 'unpublished'
  const {
    courses,
    total: courseTotal,
    pagination,
    setPagination,
    loading,
    createCourse,
    updateCourse,
    deleteCourse,
  } = useCourses()

  const isAdmin = user.role === 'ADMIN'
  const isUnitAdmin = user.role === 'UNIT_ADMIN'
  const isInstructor = user.role === 'INSTRUCTOR'
  // TA is a course-level enrollment role, not a platform role (#499).
  const isTA = taCourseIds.length > 0

  // Effective role drives which config/branch of the single CoursesView renders
  // (#1087 Group A) — order matters and mirrors the old ternary dispatch.
  const effectiveRole: CoursesRole = isAdmin
    ? 'admin'
    : isUnitAdmin
      ? 'unit-admin'
      : isInstructor
        ? 'instructor'
        : 'mixed'

  const [pendingPublish, setPendingPublish] = useState<{
    id: string
    publish: boolean
    label: string
  } | null>(null)

  const handlePublishToggle = async (id: string, publish: boolean) => {
    try {
      await updateCourse(id, { isPublished: publish })
    } catch {
      toast.error('Failed to update course. Please try again.')
    }
  }

  const handlePublishToggleRequest = (id: string, publish: boolean) => {
    const course = courses.find((c) => c.id === id)
    setPendingPublish({ id, publish, label: `${course?.code ?? ''} — ${course?.name ?? ''}`.trim() })
    return Promise.resolve()
  }

  if (loading) {
    return (
      <Layout user={user}>
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          Loading courses...
        </div>
      </Layout>
    )
  }

  return (
    <Layout user={user}>
      <div className="px-4 lg:px-6">
        {accessDenied && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            You do not have access to that course. Open a course from this list only.
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => setSearchParams({})}
            >
              Dismiss
            </button>
          </div>
        )}
        {accessUnpublished && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            That course isn&apos;t published yet. You&apos;ll be able to open it once your instructor publishes it.
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => setSearchParams({})}
            >
              Dismiss
            </button>
          </div>
        )}
        {effectiveRole === 'admin' ? (
          <CoursesView
            role="admin"
            courses={courses}
            instructors={instructors}
            onCreateCourse={async (data) => { await createCourse(data) }}
            onEditCourse={async (id, data) => { await updateCourse(id, data) }}
            onDeleteCourse={async (id) => { await deleteCourse(id) }}
            onPublishToggle={handlePublishToggleRequest}
          />
        ) : effectiveRole === 'unit-admin' ? (
          <CoursesView
            role="unit-admin"
            // `/api/courses` already scopes UNIT_ADMIN to their authorized units
            // server-side (#1041). Re-filtering the loaded page here would
            // silently drop rows that belong to the caller but happen to sit on
            // another page, so pass the server's list through unchanged.
            courses={courses}
            authorizedUnits={authorizedUnits}
            instructors={instructors}
            onCreateCourse={async (data) => { await createCourse(data) }}
            onEditCourse={async (id, data) => { await updateCourse(id, data) }}
            onDeleteCourse={async (id) => { await deleteCourse(id) }}
            onPublishToggle={handlePublishToggleRequest}
          />
        ) : effectiveRole === 'instructor' ? (
          <CoursesView
            role="instructor"
            courses={courses}
            onCreateCourse={async (data) => { await createCourse(data) }}
            onEditCourse={async (id, data) => { await updateCourse(id, data) }}
            onDeleteCourse={async (id) => { await deleteCourse(id) }}
            onPublishToggle={handlePublishToggleRequest}
          />
        ) : (
          <CoursesView
            role="mixed"
            courses={courses}
            taCourseIds={taCourseIds}
            enrolledCourseIds={enrolledCourseIds}
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
      <ConfirmDialog
        open={pendingPublish !== null}
        onOpenChange={(open) => { if (!open) setPendingPublish(null) }}
        title={
          pendingPublish
            ? pendingPublish.publish
              ? `Publish "${pendingPublish.label}"?`
              : `Unpublish "${pendingPublish.label}"?`
            : ''
        }
        description={
          pendingPublish
            ? pendingPublish.publish
              ? 'Students will be able to see this course.'
              : 'Students will lose access to this course.'
            : ''
        }
        confirmLabel={pendingPublish?.publish ? 'Publish' : 'Unpublish'}
        variant={pendingPublish?.publish ? 'default' : 'destructive'}
        onConfirm={() => {
          if (!pendingPublish) return
          void handlePublishToggle(pendingPublish.id, pendingPublish.publish)
          setPendingPublish(null)
        }}
      />
    </Layout>
  )
}

function Layout({ user, children }: { user: any; children: React.ReactNode }) {
  return (
    <CoreAppShell
      user={user}
      breadcrumbs={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild><Link to="/dashboard">Home</Link></BreadcrumbLink>
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
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            {children}
          </div>
        </div>
      </div>
    </CoreAppShell>
  )
}
