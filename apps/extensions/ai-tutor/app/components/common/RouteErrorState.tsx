/**
 * @file RouteErrorState — the in-shell boundary every route under `_app.tsx`
 * exports as its `ErrorBoundary`.
 *
 * It sorts a thrown route error into one of two answers:
 *
 *   - "not found" (404/400/403) → the generic {@link NotFoundState}. A missing
 *     record, a malformed id, and a page the user may not open all get the same
 *     page, so the app never confirms that something exists to someone who
 *     cannot see it.
 *   - anything else → a "couldn't load this" state, which is a real failure and
 *     should not be dressed up as a 404.
 *
 * Keeping the boundary on the child route (rather than on `_app.tsx`) is what
 * keeps the sidebar and header mounted: a boundary replaces its own route's
 * subtree, so a boundary on the layout would take the shell down with it.
 */
import { isRouteErrorResponse, useRouteError } from "react-router";
import { Button, Card, EmptyState } from "@eduai/ui";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";

import { ApiHttpError } from "~/lib/api";
import { NotFoundState } from "./NotFoundState";

/** HTTP status behind this error, when it carries one. */
export function statusOf(error: unknown): number | null {
  if (isRouteErrorResponse(error)) return error.status;
  if (error instanceof ApiHttpError) return error.status;
  return null;
}

/** 400 covers a malformed id (e.g. `/instructor/courses/not-a-number`). */
export function isNotFoundStatus(status: number | null): boolean {
  return status === 404 || status === 400 || status === 403;
}

export function RouteErrorState() {
  const error = useRouteError();

  if (isNotFoundStatus(statusOf(error))) {
    return <NotFoundState />;
  }

  return (
    <div className="px-4 pt-6 pb-8 lg:px-6">
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
  );
}
