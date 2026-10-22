import { useEffect, useState } from "react";
import { Link, redirect, useLoaderData, useSearchParams } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { ApiAccessAdminView } from "~/components/admin/api-access-admin-view";
import type { GrantPerson } from "~/components/admin/grant-api-access-dialog";
import { CoreAppShell } from "~/components/layout/core-app-shell";
import { fetchUserById, useApiAccessGrants } from "~/hooks/api/use-api-access";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@eduai/ui";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { notFound } from "~/lib/not-found.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);

  if (!session?.user) {
    return redirect("/auth/login");
  }
  if (session.user.role !== "ADMIN") {
    throw notFound(session.user);
  }

  return { user: session.user };
}

export default function AdminApiAccessRoute() {
  const { user } = useLoaderData<typeof loader>();
  const access = useApiAccessGrants();
  const [searchParams] = useSearchParams();
  const grantFor = searchParams.get("grantFor");
  // `undefined` while the linked person is still loading, so the view mounts
  // once with the dialog already open for them.
  const [initialPerson, setInitialPerson] = useState<GrantPerson | null | undefined>(
    grantFor ? undefined : null,
  );

  useEffect(() => {
    if (!grantFor) return;
    let cancelled = false;
    fetchUserById(grantFor)
      .then((person) => {
        if (!cancelled) setInitialPerson(person && person.role !== "ADMIN" ? person : null);
      })
      .catch(() => {
        if (!cancelled) setInitialPerson(null);
      });
    return () => {
      cancelled = true;
    };
  }, [grantFor]);

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
              <BreadcrumbPage>Admin</BreadcrumbPage>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>API Access</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      {initialPerson !== undefined && (
        <ApiAccessAdminView
          grants={access.grants}
          defaults={access.defaults}
          includeInactive={access.includeInactive}
          onIncludeInactiveChange={access.setIncludeInactive}
          isLoading={access.isLoading}
          error={access.error}
          onCreateGrant={access.createGrant}
          onRevokeGrant={access.revokeGrant}
          initialPerson={initialPerson}
        />
      )}
    </CoreAppShell>
  );
}

export { RouteErrorState as ErrorBoundary } from "~/components/shared/route-error-state";
