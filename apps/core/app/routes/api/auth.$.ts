import { auth } from "~/lib/auth/server";
import { stripInternalAuthHeaders } from "~/lib/auth/auth-handler-request";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

// Public boundary for Better Auth. Strip internal-only markers so a browser
// can't forge the invitation-signup exemption (see INTERNAL_INVITE_SIGNUP_HEADER).
export async function loader({ request }: LoaderFunctionArgs) {
  return auth.handler(stripInternalAuthHeaders(request));
}

export async function action({ request }: ActionFunctionArgs) {
  return auth.handler(stripInternalAuthHeaders(request));
}
