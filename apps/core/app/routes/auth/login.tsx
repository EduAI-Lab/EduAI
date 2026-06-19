import { Form, useActionData, useLoaderData, redirect } from "react-router"
import { SquareLibrary } from "lucide-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"

import { LoginForm } from "~/components/login-form"
import { signInSchema, type SignInInput } from "~/lib/auth"
import { buildAuthSubRequest } from "~/lib/auth/auth-handler-request"
import { appendAuthSetCookies } from "~/lib/auth/forward-session-cookies"
import { auth } from "~/lib/auth/server"
import { validateRedirectUrl } from "~/lib/auth/guards.server"
import { getPolicy } from "~/lib/policy.server"
import { fireAndForget, logSecurityEvent } from "~/lib/logging.server"
import { getActorContext, getRequestContext } from "~/lib/request-context.server"

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const redirectTo = validateRedirectUrl(url.searchParams.get("redirect"));
  const session = await auth.api.getSession(request);

  if (session?.user) {
    return redirect(redirectTo);
  }

  // §6b: gate the "Sign up" link server-side (the login page is unauthenticated,
  // so usePolicies() is unavailable here).
  const allowRegistration = await getPolicy("auth.allowPublicRegistration");

  return { redirectTo, allowRegistration };
}

export async function action({ request }: ActionFunctionArgs) {
  const requestContext = getRequestContext(request);
  const formData = Object.fromEntries(await request.formData());
  const redirectTo = validateRedirectUrl(String(formData.redirectTo || ""));
  const input = {
    email: String(formData.email || ""),
    password: String(formData.password || ""),
  };

  const result = signInSchema.safeParse(input);
  if (!result.success) {
    const fieldErrors: Partial<Record<keyof SignInInput, string>> = {};
    result.error.issues.forEach((issue) => {
      const field = issue.path[0] as keyof SignInInput;
      if (field && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    });
    return { fieldErrors };
  }

  try {
    // Do not forward session cookies — stale tokens after logout break re-login.
    const authRequest = buildAuthSubRequest(
      "/api/auth/sign-in/email",
      request,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: input.email,
          password: input.password,
        }),
      },
    );

    const response = await auth.handler(authRequest);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      fireAndForget(
        logSecurityEvent({
          ...getActorContext(null),
          ...requestContext,
          actionCode: "LOGIN_FAILED",
          outcome: "FAILURE",
          entityType: "Auth",
          // The attempted email is the only identifier on a failed login (no actor
          // exists yet), so it must be stored for security triage.
          entityLabel: input.email,
          details: { email: input.email },
        }),
      );
      return {
        formError:
          (errorData as { message?: string }).message ||
          (errorData as { error?: string }).error ||
          `Sign in failed (${response.status})`,
      };
    }

    const headers = new Headers();
    appendAuthSetCookies(response, headers);

    // Attribute the success to the just-authenticated user so the audit log names the actor
    // instead of "Unknown". The user normally lives in the better-auth sign-in response body.
    const signedIn = (await response
      .clone()
      .json()
      .catch(() => null)) as { user?: { id?: string; role?: string | null } } | null;
    let signedInUser = signedIn?.user?.id
      ? { id: signedIn.user.id, role: signedIn.user.role ?? null }
      : null;

    // Fallback: if the response body didn't carry the user, resolve the session
    // from the freshly-issued cookies so a successful login is never logged as
    // anonymous if better-auth's response shape changes.
    if (!signedInUser) {
      const setCookies =
        typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
      const cookieHeader = setCookies
        .map((cookie) => cookie.split(";")[0])
        .filter(Boolean)
        .join("; ");
      if (cookieHeader) {
        const session = await auth.api
          .getSession(new Request(request.url, { headers: { cookie: cookieHeader } }))
          .catch(() => null);
        if (session?.user) {
          signedInUser = { id: session.user.id, role: session.user.role ?? null };
        }
      }
    }

    fireAndForget(
      logSecurityEvent({
        ...getActorContext(signedInUser),
        ...requestContext,
        actionCode: "LOGIN_SUCCESS",
        outcome: "SUCCESS",
        entityType: "Auth",
        entityId: signedInUser?.id ?? null,
        entityLabel: input.email,
        details: { email: input.email },
      }),
    );

    return redirect(redirectTo, { headers });
  } catch (err: unknown) {
    let message = "Sign in failed";
    if (typeof err === "object" && err && "message" in err) {
      message = String((err as { message?: string }).message ?? message);
    }
    fireAndForget(
      logSecurityEvent({
        ...getActorContext(null),
        ...requestContext,
        actionCode: "LOGIN_FAILED",
        outcome: "FAILURE",
        entityType: "Auth",
        entityLabel: input.email,
        details: { email: input.email },
      }),
    );
    return { formError: message };
  }
}

export default function LoginPage() {
  const actionData = useActionData() as {
    fieldErrors?: Partial<Record<keyof SignInInput, string>>;
    formError?: string;
  } | undefined;
  const { redirectTo, allowRegistration } = useLoaderData() as {
    redirectTo: string;
    allowRegistration: boolean;
  };

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="#" className="flex items-center gap-2 font-medium">
            <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
              <SquareLibrary className="size-4" />
            </div>
            EduAI
          </a>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">
            <Form method="post">
              <input type="hidden" name="redirectTo" value={redirectTo} />
              {actionData?.formError && (
                <div className="mb-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                  {actionData.formError}
                </div>
              )}
              <LoginForm
                fieldErrors={actionData?.fieldErrors}
                isLoading={false}
                allowRegistration={allowRegistration}
              />
            </Form>
          </div>
        </div>
      </div>
      <div className="bg-muted relative hidden lg:block">
        <img
          src="/placeholder.svg"
          alt="Image"
          className="absolute inset-0 h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
        />
      </div>
    </div>
  )
}
