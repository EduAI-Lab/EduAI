import { Link, redirect, useLoaderData } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'

import { auth } from '~/lib/auth/server'
import prisma from '~/lib/prisma.server'
import { AppSidebar } from '~/components/app-sidebar'
import { SiteHeader } from '~/components/site-header'
import {
  SidebarInset,
  SidebarProvider,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@eduai/ui'
import { CourseChatsPanel } from '~/components/courses/course-chats-panel'
import { useUnitChats } from '~/hooks/api/use-course-chats'

/**
 * Unit-level chats view for UNIT_ADMIN (§5d). The endpoint
 * GET /api/units/:department/chats is the security boundary; this page just
 * renders it. Non unit/admin callers, or a department outside the caller's
 * authorized units, are redirected.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return redirect('/auth/login')

  const department = params.department
  if (!department) return redirect('/courses')

  const role = session.user.role
  if (role !== 'ADMIN' && role !== 'UNIT_ADMIN') {
    return redirect('/courses?access=denied')
  }

  if (role === 'UNIT_ADMIN') {
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { authorizedUnits: true },
    })
    if (!(dbUser?.authorizedUnits ?? []).includes(department)) {
      return redirect('/courses?access=denied')
    }
  }

  // §541: resolve the human-readable unit label from the Discipline table.
  const discipline = await prisma.discipline.findUnique({
    where: { code: department },
    select: { name: true },
  })
  const departmentLabel = discipline?.name ?? department

  return { user: session.user, department, departmentLabel }
}

export default function UnitChatsPage() {
  const { user, department, departmentLabel } = useLoaderData<typeof loader>()
  const { chats, loading, error } = useUnitChats(department)
  const codeById = new Map(chats.map((c) => [c.id, c.courseCode]))

  return (
    <SidebarProvider
      style={{
        '--sidebar-width': 'calc(var(--spacing) * 72)',
        '--header-height': 'calc(var(--spacing) * 12)',
      } as React.CSSProperties}
    >
      <AppSidebar variant="inset" user={user} />
      <SidebarInset>
        <SiteHeader
          title="Unit Chats"
          breadcrumbs={
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild><Link to="/dashboard">Home</Link></BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{departmentLabel} Chats</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
        />
        <div className="flex flex-1 flex-col">
          <div className="px-4 lg:px-6 py-6 flex flex-col gap-4">
            <div>
              <h1 className="text-3xl font-bold">Unit Chats</h1>
              <p className="text-muted-foreground mt-1">
                Student chats across courses in {departmentLabel}.
              </p>
            </div>
            <CourseChatsPanel
              chats={chats}
              loading={loading}
              error={error}
              secondaryLabel={(id) => codeById.get(id) ?? null}
            />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
