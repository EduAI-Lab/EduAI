import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { buildAuthSubRequest } from "~/lib/auth/auth-handler-request";
import { appendAuthSetCookies } from "~/lib/auth/forward-session-cookies";
import { auth } from "~/lib/auth/server";
import { clearUserPreference } from "~/lib/user-preferences.server";

/** GET /auth/logout → login page */
export async function loader(_args: LoaderFunctionArgs) {
  return redirect("/auth/login");
}

/** POST /auth/logout — invalidate session and clear cookies via Better Auth */
export async function action({ request }: ActionFunctionArgs) {
  // Clear per-user chat prefs before the session is invalidated (#420).
  const session = await auth.api.getSession(request);
  if (session?.user) {
    try {
      await clearUserPreference(session.user.id);
    } catch (error) {
      console.error("Failed to clear user preferences on logout:", error);
    }
  }

  const authRequest = buildAuthSubRequest(
    "/api/auth/sign-out",
    request,
    { method: "POST" },
    { forwardCookies: true },
  );

  const response = await auth.handler(authRequest);
  const headers = new Headers();
  appendAuthSetCookies(response, headers);

  return redirect("/auth/login", { headers });
}

export default function LogoutRoute() {
  return null;
}
