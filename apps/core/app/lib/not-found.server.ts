import { data } from "react-router";

import type { User } from "~/lib/auth/types";

/** Payload a {@link notFound} response carries to `RouteErrorState`. */
export type NotFoundErrorData = { user: User };

/**
 * Answer a page loader with the generic 404 instead of redirecting away:
 * `throw notFound(user)`, the same way loaders `throw redirect(...)`.
 *
 * Used both for a record that doesn't exist and for a page the signed-in user
 * may not open — the two must look identical so the response never confirms
 * that something exists. The user rides along so the route's `ErrorBoundary`
 * can keep the sidebar and header mounted around the 404.
 */
export function notFound(user: User) {
  return data({ user } satisfies NotFoundErrorData, { status: 404 });
}
