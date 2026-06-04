import { redirect, useLoaderData } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'

import { auth } from '~/lib/auth/server'
import { AppSidebar } from '~/components/app-sidebar'
import { SiteHeader } from '~/components/site-header'
import { SidebarInset, SidebarProvider } from '~/components/ui/sidebar'
import { CoursesAdminView } from '~/components/courses/courses-admin-view'
import { CoursesUnitAdminView } from '~/components/courses/courses-unit-admin-view'
import { CoursesInstructorView } from '~/components/courses/courses-instructor-view'
import { CoursesTaView } from '~/components/courses/courses-ta-view'
import { CoursesStudentView } from '~/components/courses/courses-student-view'
import { useCourses } from '~/hooks/api/use-courses'
import type { RbacUser } from '~/lib/rbac'

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request)
  if (!session?.user) return redirect('/auth/login')
  return { user: session.user }
}

export default function CoursesPage() {
  const { user } = useLoaderData<typeof loader>()
  const { courses, loading, createCourse, updateCourse } = useCourses()

  const rbacUser: RbacUser = {
    id: user.id,
    role: user.role as RbacUser['role'],
    authorizedUnits: (user as any).authorizedUnits ?? [],
  }

  const isAdmin = rbacUser.role === 'ADMIN'
  const isUnitAdmin = rbacUser.role === 'UNIT_ADMIN'
  const isProfessor = rbacUser.role === 'PROFESSOR'
  const isTA = rbacUser.role === 'TA'

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
            onDeleteCourse={async (_id) => { /* stub — no delete endpoint */ }}
          />
        ) : isUnitAdmin ? (
          <CoursesUnitAdminView
            courses={courses.filter((c) =>
              c.department !== null && rbacUser.authorizedUnits.includes(c.department)
            )}
            authorizedUnits={rbacUser.authorizedUnits}
            onCreateCourse={async (data) => { await createCourse(data) }}
            onEditCourse={async (id, data) => { await updateCourse(id, data) }}
          />
        ) : isProfessor ? (
          <CoursesInstructorView
            courses={courses.filter((c) => c.professorId === user.id)}
            onEditCourse={async (id, data) => { await updateCourse(id, data) }}
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
