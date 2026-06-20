import { Link, useLoaderData, redirect } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'

import { UsersAdminView } from '~/components/admin/users-admin-view'
import { AppSidebar } from '~/components/app-sidebar'
import { SiteHeader } from '~/components/site-header'
import { SidebarInset, SidebarProvider } from '@eduai/ui'
import { useUsers } from '~/hooks/api/use-users'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@eduai/ui'
import { auth } from '~/lib/auth/server'

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request)

  if (!session?.user) {
    return redirect('/auth/login')
  }

  if (session.user.role !== 'ADMIN') {
    return redirect('/dashboard')
  }

  return {
    user: session.user,
  }
}

export default function UsersPage() {
  const { user } = useLoaderData<typeof loader>()
  const {
    users,
    isLoading,
    error,
    createUser,
    updateUser,
    deleteUser,
    toggleUserActive,
  } = useUsers()

  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 72)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as React.CSSProperties
      }
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
                  <BreadcrumbPage>Admin</BreadcrumbPage>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Users</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
        />
        <UsersAdminView
          users={users}
          isLoading={isLoading}
          error={error}
          currentUserId={user.id}
          onCreateUser={createUser}
          onUpdateUser={updateUser}
          onDeleteUser={deleteUser}
          onToggleUserActive={toggleUserActive}
        />
      </SidebarInset>
    </SidebarProvider>
  )
}
