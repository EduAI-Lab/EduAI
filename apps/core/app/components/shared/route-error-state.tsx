/**
 * @file RouteErrorState — the `ErrorBoundary` signed-in page routes export.
 *
 * It sorts a thrown route error into one of two answers, mirroring AI Tutor:
 *
 *   - "not found" (404) → the shared `@eduai/ui` NotFoundState. When the loader
 *     threw via `notFound(user)` the 404 renders inside `CoreAppShell`, so the
 *     reader keeps the sidebar and can navigate onwards.
 *   - anything else → a "couldn't load this" state, which is a real failure and
 *     should not be dressed up as a 404.
 *
 * Keeping the boundary on the route (rather than relying on root.tsx) is what
 * lets the shell render: root's boundary replaces the whole app, providers
 * included.
 */
import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { Button, Card, EmptyState, NotFoundState } from "@eduai/ui";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";

import { CoreAppShell } from "~/components/layout/core-app-shell";
import type { NotFoundErrorData } from "~/lib/not-found.server";

export function RouteErrorState() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) {
    // A 404 from `notFound(user)` carries the viewer; any other 404 does not.
    const user: NotFoundErrorData["user"] | undefined = error.data?.user;
    if (!user) return <NotFoundState standalone LinkComponent={Link} />;
    // Explicit title: the route-derived one would name the page the reader
    // cannot open.
    return (
      <CoreAppShell user={user} title="Page not found">
        <NotFoundState LinkComponent={Link} />
      </CoreAppShell>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-xl">
        <Card>
          <EmptyState
            icon={<IconAlertTriangle size={22} aria-hidden="true" />}
            title="This page could not be loaded"
            description="Something went wrong on our side. Try again in a moment."
            action={
              <Button type="button" variant="outline" onClick={() => window.location.reload()}>
                <IconRefresh className="size-4" aria-hidden="true" />
                Try again
              </Button>
            }
          />
        </Card>
      </div>
    </main>
  );
}
