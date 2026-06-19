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
      return {
        formError:
          (errorData as { message?: string }).message ||
          (errorData as { error?: string }).error ||
          `Sign in failed (${response.status})`,
      };
    }

    const headers = new Headers();
    appendAuthSetCookies(response, headers);

    return redirect(redirectTo, { headers });
  } catch (err: unknown) {
    let message = "Sign in failed";
    if (typeof err === "object" && err && "message" in err) {
      message = String((err as { message?: string }).message ?? message);
    }
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
