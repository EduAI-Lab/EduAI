import { Link, useLoaderData, redirect } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'

import { UsersAdminView } from '~/components/admin/users-admin-view'
import { CoreAppShell } from '~/components/layout/core-app-shell'
import { useUsers } from '~/hooks/api/use-users'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@eduai/ui'
import { getRequestSession } from "~/lib/auth/request-session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getRequestSession(request)

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
    total,
    stats,
    setQuery,
    isLoading,
    error,
    createUser,
    updateUser,
    deleteUser,
    toggleUserActive,
  } = useUsers()

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
              <BreadcrumbPage>Admin</BreadcrumbPage>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Users</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      <UsersAdminView
        users={users}
        total={total}
        stats={stats}
        onQueryChange={setQuery}
        isLoading={isLoading}
        error={error}
        currentUserId={user.id}
        onCreateUser={createUser}
        onUpdateUser={updateUser}
        onDeleteUser={deleteUser}
        onToggleUserActive={toggleUserActive}
      />
    </CoreAppShell>
  )
}
