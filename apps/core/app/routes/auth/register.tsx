import { Form, Link, useActionData, useLoaderData, redirect } from "react-router"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"

import { RegisterForm } from "~/components/register-form"
import { redirectToStudentIdOnboardingIfNeeded } from "~/lib/canvas/onboarding.server"
import { signUpSchema, type SignUpInput } from "~/lib/auth"
import { buildAuthSubRequest } from "~/lib/auth/auth-handler-request"
import { appendAuthSetCookies } from "~/lib/auth/forward-session-cookies"
import { auth } from "~/lib/auth/server"
import { getPolicy } from "~/lib/policy.server"

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);

  if (session?.user) {
    const onboardingRedirect = await redirectToStudentIdOnboardingIfNeeded(
      session.user.id,
      session.user.role,
      request,
    );
    if (onboardingRedirect) {
      return onboardingRedirect;
    }
    return redirect("/dashboard");
  }

  // §6b / issue #807: when public registration is disabled, deep-linking
  // /auth/register no longer silently redirects to /login (which reads as a
  // bug). Instead the page renders an explicit "registration is invite-only"
  // message. Read the flag server-side (the signup page is unauthenticated, so
  // usePolicies() is unavailable here).
  if (!(await getPolicy("auth.allowPublicRegistration"))) {
    return { registrationDisabled: true };
  }

  return { registrationDisabled: false };
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = Object.fromEntries(await request.formData());
  const input = {
    name: String(formData.name || ""),
    email: String(formData.email || ""),
    password: String(formData.password || ""),
    confirmPassword: String(formData.confirmPassword || ""),
  };
  const result = signUpSchema.safeParse(input);
  if (!result.success) {
    const fieldErrors: Partial<Record<keyof SignUpInput, string>> = {};
    result.error.issues.forEach((issue) => {
      const field = issue.path[0] as keyof SignUpInput;
      if (field && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    });
    return { fieldErrors };
  }

  try {
    const authRequest = buildAuthSubRequest(
      "/api/auth/sign-up/email",
      request,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: input.name,
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
          `Sign up failed (${response.status})`,
      };
    }

    const headers = new Headers();
    appendAuthSetCookies(response, headers);

    return redirect("/onboarding/student-id", { headers });
  } catch (err: unknown) {
    let message = "Sign up failed";
    if (typeof err === "object" && err && "message" in err) {
      message = String((err as { message?: string }).message ?? message);
    }
    return { formError: message };
  }
}

export default function RegisterPage() {
  const [isLoading, setIsLoading] = useState(false);
  const { registrationDisabled } = useLoaderData() as {
    registrationDisabled: boolean;
  };
  const actionData = useActionData() as {
    fieldErrors?: Partial<Record<keyof SignUpInput, string>>;
    formError?: string;
  } | undefined;

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
        {registrationDisabled ? (
          // §807: public registration is off — explain it's invite-only instead
          // of bouncing the user to /login with no context.
          <div className="flex flex-col items-center gap-4 text-center">
            <h1 className="text-lg font-semibold text-foreground">Registration is invite-only</h1>
            <p className="text-sm text-muted-foreground">
              New accounts on this platform are created by invitation. Ask your
              administrator or instructor to send you an invite, then use the link
              in that email to set up your account.
            </p>
            <Link
              to="/auth/login"
              className="text-sm text-primary underline underline-offset-4"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <Form method="post">
            {actionData?.formError && (
              <p className="text-sm text-destructive mb-4 text-center">{actionData.formError}</p>
            )}
            <RegisterForm fieldErrors={actionData?.fieldErrors} isLoading={isLoading} />
          </Form>
        )}
      </div>

      <p className="mt-5 text-xs text-muted-foreground">University of British Columbia · EduAI Platform</p>
    </div>
  )
}