import { Form, useActionData, useLoaderData, redirect } from "react-router"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"

import { LoginForm } from "~/components/login-form"
import { DemoLoginButtons } from "~/components/auth/demo-login-buttons"
import { signInSchema, type SignInInput } from "~/lib/auth"
import { buildAuthSubRequest } from "~/lib/auth/auth-handler-request"
import { appendAuthSetCookies } from "~/lib/auth/forward-session-cookies"
import { auth } from "~/lib/auth/server"
import { validateRedirectUrl } from "~/lib/auth/guards.server"

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const redirectTo = validateRedirectUrl(url.searchParams.get("redirect"));
  const session = await auth.api.getSession(request);

  if (session?.user) {
    return redirect(redirectTo);
  }

  return { redirectTo };
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
  const { redirectTo } = useLoaderData() as { redirectTo: string };

  return (
    <div
      className="min-h-svh flex flex-col items-center justify-center relative font-sans"
      style={{ background: "var(--muted)" }}
    >
      {/* Gold top bar */}
      <div className="fixed top-0 left-0 right-0 h-[3px] z-10" style={{ background: "var(--gold)" }} />

      {/* Logo */}
      <div className="flex items-center gap-2 mb-7">
        <div
          className="w-9 h-9 rounded-[9px] flex items-center justify-center"
          style={{ background: "var(--primary)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.75" strokeLinecap="round">
            <circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18"/><path d="M3 12h18"/><path d="M12 3c2 2 3.5 5.5 3.5 9s-1.5 7-3.5 9"/>
          </svg>
        </div>
        <span className="text-xl font-bold" style={{ color: "var(--primary)", letterSpacing: "-0.01em" }}>EduAI</span>
      </div>

      {/* Card */}
      <div className="w-full max-w-[440px] mx-4 bg-card border rounded-[var(--radius-xl)] p-9 shadow-lg" style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
        <Form method="post">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          {actionData?.formError && (
            <p className="text-sm text-destructive mb-4 text-center">{actionData.formError}</p>
          )}
          <LoginForm fieldErrors={actionData?.fieldErrors} isLoading={false} />
        </Form>

        <DemoLoginButtons redirectTo={redirectTo} />
      </div>

      <p className="mt-5 text-xs text-muted-foreground">University of British Columbia · EduAI Platform</p>
    </div>
  )
}
