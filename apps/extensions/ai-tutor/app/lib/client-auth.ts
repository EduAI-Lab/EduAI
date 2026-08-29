import { redirect } from "react-router";
import api from "~/lib/api";
import type { Role, User } from "~/lib/types";

/**
 * Resolve the signed-in user, optionally requiring one of `role`.
 *
 * Three failures, three different answers:
 *
 *   - **No session**: redirect to `/`, which sends the reader on to Core's
 *     login. Signing in is the way out, so a redirect is the honest response.
 *   - **`/api/me` itself fails**: let it throw. A Core outage is not the same as
 *     being logged out, and swallowing it here would bounce the reader to login
 *     as if their session had ended.
 *   - **Signed in, wrong role**: throw a 404. This used to redirect to `/` too,
 *     which silently dropped the reader on the dashboard with no explanation.
 *     A 404 also avoids confirming that a page exists to someone who may not
 *     open it — the route's `ErrorBoundary` renders the generic not-found page.
 */
export async function requireClientUser(role?: Role | Role[]): Promise<User> {
  const { user } = await api.me();
  if (!user) throw redirect("/");
  if (role) {
    const allowed = Array.isArray(role) ? role : [role];
    if (!allowed.includes(user.role)) {
      throw new Response("Not Found", { status: 404 });
    }
  }
  return user;
}
