import { auth } from "~/lib/auth/server";
import { stripInternalAuthHeaders } from "~/lib/auth/auth-handler-request";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { withErrorResponse } from "~/lib/errors.server";

// Public boundary for Better Auth. Strip internal-only markers so a browser
// can't forge the invitation-signup exemption (see INTERNAL_INVITE_SIGNUP_HEADER).
export async function loader({ request }: LoaderFunctionArgs) {
  return withErrorResponse(
    async () => {
      return auth.handler(stripInternalAuthHeaders(request));
    },
    { request },
  );
}

export async function action({ request }: ActionFunctionArgs) {
  return withErrorResponse(
    async () => {
      return auth.handler(stripInternalAuthHeaders(request));
    },
    { request },
  );
}
