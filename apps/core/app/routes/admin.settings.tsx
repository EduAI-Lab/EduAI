import { Link, useLoaderData, redirect } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'

import { CoreAppShell } from '~/components/layout/core-app-shell'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Switch,
  PageHeading,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Alert,
  AlertDescription,
  AlertTitle,
} from '@eduai/ui'
import { usePolicies } from '~/hooks/api/use-policies'
import { getEnvironmentHealth } from '~/lib/environment-health.server'
import { getRequestSession } from "~/lib/auth/request-session.server";

/**
 * Permission groups for the admin settings UI, in display order. Each policy
 * flag is bucketed by its key prefix (`instructors.*`, `students.*`, …) into the
 * first group whose `match` passes — so `general` (match-all) is the catch-all
 * for non-role-scoped switches like `chat.*` and `auth.*`.
 */
const PERMISSION_GROUPS: {
  id: string
  title: string
  description: string
  match: (prefix: string) => boolean
}[] = [
  {
    id: 'instructors',
    title: 'Instructors',
    description: 'What users with the INSTRUCTOR role may do.',
    match: (p) => p === 'instructors',
  },
  {
    id: 'students',
    title: 'Students',
    description: 'What users with the STUDENT role may do.',
    match: (p) => p === 'students',
  },
  {
    id: 'tas',
    title: 'Teaching Assistants',
    description: 'What users with the TA role may do.',
    match: (p) => p === 'tas',
  },
  {
    id: 'unitAdmins',
    title: 'Unit Admins',
    description: 'What users with the UNIT_ADMIN role may do.',
    match: (p) => p === 'unitAdmins',
  },
  {
    id: 'general',
    title: 'General',
    description: 'Settings that apply to everyone, not just one role.',
    match: () => true,
  },
]

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
    environmentHealth: getEnvironmentHealth(),
  }
}

export default function AdminSettingsPage() {
  const { user, environmentHealth } = useLoaderData<typeof loader>()
  const { policies, definitions, isLoading, error, setPolicy } = usePolicies()

  // Bucket each flag into the first group whose `match` passes, preserving the
  // PERMISSION_GROUPS order; drop empty groups so we never render a stray card.
  const groups = PERMISSION_GROUPS.map((group) => ({
    ...group,
    items: definitions.filter(
      (def) =>
        PERMISSION_GROUPS.find((g) => g.match(def.key.split('.')[0]))?.id === group.id,
    ),
  })).filter((group) => group.items.length > 0)

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
              <BreadcrumbPage>Settings</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            <div className="px-4 lg:px-6">
              <PageHeading
                heading="Settings"
                subheading="Toggle role-based capabilities across the platform. Changes take effect live."
              />
            </div>

            {error ? (
              <div className="px-4 lg:px-6">
                <p className="text-destructive text-sm" role="alert">{error}</p>
              </div>
            ) : null}

            <div className="flex flex-col gap-4 px-4 md:gap-6 lg:px-6">
              {environmentHealth.missingKeys.length > 0 ? (
                <Alert variant="destructive">
                  <AlertTitle>Environment configuration is incomplete</AlertTitle>
                  <AlertDescription>
                    Missing: {environmentHealth.missingKeys.join(', ')}. Add the key
                    to this deployment&apos;s environment and restart the service.
                  </AlertDescription>
                </Alert>
              ) : null}
              {isLoading ? (
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-muted-foreground text-sm">Loading…</p>
                  </CardContent>
                </Card>
              ) : groups.length === 0 ? (
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-muted-foreground text-sm">No configurable policies.</p>
                  </CardContent>
                </Card>
              ) : (
                groups.map((group) => (
                  <Card key={group.id}>
                    <CardHeader>
                      <CardTitle>{group.title}</CardTitle>
                      <CardDescription>{group.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-6">
                      {group.items.map((def) => (
                        <div key={def.key} className="flex items-start justify-between gap-4">
                          <div className="space-y-1">
                            <Label htmlFor={def.key} className="text-base">{def.label}</Label>
                            <p className="text-muted-foreground text-sm">{def.description}</p>
                          </div>
                          <Switch
                            id={def.key}
                            checked={policies[def.key] ?? def.default}
                            onCheckedChange={(value) => setPolicy(def.key, value)}
                          />
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </CoreAppShell>
  )
}
