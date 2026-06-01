import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { buildAuthSubRequest } from "~/lib/auth/auth-handler-request";
import { appendAuthSetCookies } from "~/lib/auth/forward-session-cookies";
import { auth } from "~/lib/auth/server";

/** GET /auth/logout → login page */
export async function loader(_args: LoaderFunctionArgs) {
  return redirect("/auth/login");
}

/** POST /auth/logout — invalidate session and clear cookies via Better Auth */
export async function action({ request }: ActionFunctionArgs) {
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
