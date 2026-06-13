import { Link, redirect, useLoaderData, useSearchParams } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'

import { auth } from '~/lib/auth/server'
import prisma from '~/lib/prisma.server'
import { AppSidebar } from '~/components/app-sidebar'
import { SiteHeader } from '~/components/site-header'
import { SidebarInset, SidebarProvider } from '@eduai/ui'
import { CoursesAdminView } from '~/components/courses/courses-admin-view'
import { CoursesUnitAdminView } from '~/components/courses/courses-unit-admin-view'
import { CoursesInstructorView } from '~/components/courses/courses-instructor-view'
import { CoursesTaView } from '~/components/courses/courses-ta-view'
import { CoursesStudentView } from '~/components/courses/courses-student-view'
import { useCourses } from '~/hooks/api/use-courses'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@eduai/ui'

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request)
  if (!session?.user) return redirect('/auth/login')

  // Fetch authorizedUnits directly from DB — Better Auth session may not include
  // custom array fields reliably across all environments.
  let authorizedUnits: string[] = []
  if (session.user.role === 'UNIT_ADMIN') {
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { authorizedUnits: true },
    })
    authorizedUnits = dbUser?.authorizedUnits ?? []
  }

  // Fetch instructors for course creation forms (ADMIN and UNIT_ADMIN only)
  let instructors: { id: string; name: string | null; email: string }[] = []
  if (session.user.role === 'ADMIN' || session.user.role === 'UNIT_ADMIN') {
    instructors = await prisma.user.findMany({
      where: { role: 'INSTRUCTOR', isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    })
  }

  // Scope list to assignments so detail loader access matches visible cards (§5 list gate)
  let taCourseIds: string[] = []
  let enrolledCourseIds: string[] = []
  if (session.user.role === 'TA') {
    const rows = await prisma.courseTA.findMany({
      where: { userId: session.user.id },
      select: { courseId: true },
    })
    taCourseIds = rows.map((r) => r.courseId)
  }
  if (session.user.role === 'STUDENT') {
    const rows = await prisma.enrollment.findMany({
      where: { userId: session.user.id, isActive: true },
      select: { courseId: true },
    })
    enrolledCourseIds = rows.map((r) => r.courseId)
  }

  return { user: session.user, authorizedUnits, taCourseIds, enrolledCourseIds, instructors }
}

export default function CoursesPage() {
  const { user, authorizedUnits, taCourseIds, enrolledCourseIds, instructors } = useLoaderData<typeof loader>()
  const [searchParams, setSearchParams] = useSearchParams()
  const accessDenied = searchParams.get('access') === 'denied'
  const { courses, loading, createCourse, updateCourse, deleteCourse } = useCourses()

  const isAdmin = user.role === 'ADMIN'
  const isUnitAdmin = user.role === 'UNIT_ADMIN'
  const isInstructor = user.role === 'INSTRUCTOR'
  const isTA = user.role === 'TA'

  const handlePublishToggle = async (id: string, publish: boolean) => {
    await updateCourse(id, { isPublished: publish })
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
      <div className="px-4 lg:px-6 py-4">
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
        {isAdmin ? (
          <CoursesAdminView
            courses={courses}
            instructors={instructors}
            onCreateCourse={async (data) => { await createCourse(data) }}
            onEditCourse={async (id, data) => { await updateCourse(id, data) }}
            onDeleteCourse={async (id) => { await deleteCourse(id) }}
            onPublishToggle={handlePublishToggle}
          />
        ) : isUnitAdmin ? (
          <CoursesUnitAdminView
            courses={courses.filter(
              (c) => c.department !== null && authorizedUnits.includes(c.department)
            )}
            authorizedUnits={authorizedUnits}
            instructors={instructors}
            onCreateCourse={async (data) => { await createCourse(data) }}
            onEditCourse={async (id, data) => { await updateCourse(id, data) }}
            onDeleteCourse={async (id) => { await deleteCourse(id) }}
            onPublishToggle={handlePublishToggle}
          />
        ) : isInstructor ? (
          <CoursesInstructorView
            courses={courses}
            onEditCourse={async (id, data) => { await updateCourse(id, data) }}
            onPublishToggle={handlePublishToggle}
          />
        ) : isTA ? (
          <CoursesTaView courses={courses} />
        ) : (
          <CoursesStudentView
            courses={courses.filter(
              (c) => enrolledCourseIds.includes(c.id) && c.isPublished,
            )}
          />
        )}
      </div>
    </Layout>
  )
}

function Layout({ user, children }: { user: any; children: React.ReactNode }) {
  return (
    <SidebarProvider
      style={{
        '--sidebar-width': 'calc(var(--spacing) * 72)',
        '--header-height': 'calc(var(--spacing) * 12)',
      } as React.CSSProperties}
    >
      <AppSidebar user={user} />
      <SidebarInset>
        <SiteHeader
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
        />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              {children}
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
