import { Link, useLoaderData, redirect } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'

import { AppSidebar } from '~/components/app-sidebar'
import { SiteHeader } from '~/components/site-header'
import { SidebarInset, SidebarProvider } from '~/components/ui/sidebar'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Label } from '~/components/ui/label'
import { Switch } from '~/components/ui/switch'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '~/components/ui/breadcrumb'
import { usePolicies } from '~/hooks/api/use-policies'
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

export default function PermissionsPage() {
  const { user } = useLoaderData<typeof loader>()
  const { policies, definitions, isLoading, error, setPolicy } = usePolicies()

  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 72)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" user={user} />
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
                  <BreadcrumbPage>Permissions</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
        />
        <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Permissions</h1>
            <p className="text-muted-foreground text-sm">
              Toggle role-based capabilities across the platform. Changes take effect live.
            </p>
          </div>

          {error ? (
            <p className="text-destructive text-sm" role="alert">{error}</p>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Configurable policies</CardTitle>
              <CardDescription>
                These flags govern what each role may do in Core and the connected apps.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {isLoading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
              ) : definitions.length === 0 ? (
                <p className="text-muted-foreground text-sm">No configurable policies.</p>
              ) : (
                definitions.map((def) => (
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
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
