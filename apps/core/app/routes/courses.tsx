import { redirect, useLoaderData } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'

import { auth } from '~/lib/auth/server'
import prisma from '~/lib/prisma.server'
import { AppSidebar } from '~/components/app-sidebar'
import { SiteHeader } from '~/components/site-header'
import { SidebarInset, SidebarProvider } from '~/components/ui/sidebar'
import { CoursesAdminView } from '~/components/courses/courses-admin-view'
import { CoursesUnitAdminView } from '~/components/courses/courses-unit-admin-view'
import { CoursesInstructorView } from '~/components/courses/courses-instructor-view'
import { CoursesTaView } from '~/components/courses/courses-ta-view'
import { CoursesStudentView } from '~/components/courses/courses-student-view'
import { useCourses } from '~/hooks/api/use-courses'

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

  return { user: session.user, authorizedUnits }
}

export default function CoursesPage() {
  const { user, authorizedUnits } = useLoaderData<typeof loader>()
  const { courses, loading, createCourse, updateCourse, deleteCourse } = useCourses()

  const isAdmin = user.role === 'ADMIN'
  const isUnitAdmin = user.role === 'UNIT_ADMIN'
  const isProfessor = user.role === 'PROFESSOR'
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
        {isAdmin ? (
          <CoursesAdminView
            courses={courses}
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
            onCreateCourse={async (data) => { await createCourse(data) }}
            onEditCourse={async (id, data) => { await updateCourse(id, data) }}
            onDeleteCourse={async (id) => { await deleteCourse(id) }}
            onPublishToggle={handlePublishToggle}
          />
        ) : isProfessor ? (
          <CoursesInstructorView
            courses={courses.filter((c) => c.professorId === user.id)}
            onEditCourse={async (id, data) => { await updateCourse(id, data) }}
            onPublishToggle={handlePublishToggle}
          />
        ) : isTA ? (
          <CoursesTaView courses={courses} />
        ) : (
          <CoursesStudentView courses={courses} />
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
      <AppSidebar variant="inset" user={user} />
      <SidebarInset>
        <SiteHeader user={user} />
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
