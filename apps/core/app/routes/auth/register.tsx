import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { RegisterForm } from "~/components/register-form";
import { redirectToStudentIdOnboardingIfNeeded } from "~/lib/canvas/onboarding.server";
import { signUpSchema, type SignUpInput } from "~/lib/auth";
import { buildAuthSubRequest } from "~/lib/auth/auth-handler-request";
import { auth } from "~/lib/auth/server";
import { getPolicy } from "~/lib/policy.server";
import { messageFromCause } from "~/lib/form-errors";
import {
  MultipartBodyInvalidError,
  MultipartBodyTooLargeError,
  readBoundedFormData,
} from "~/lib/multipart.server";
import { getRequestSession } from "~/lib/auth/request-session.server";

export const AUTH_FORM_BODY_MAX_BYTES = 64 * 1024;

function formBodyErrorResponse(cause: unknown): Response | null {
  if (cause instanceof MultipartBodyTooLargeError) {
    return new Response(JSON.stringify({ error: "PAYLOAD_TOO_LARGE" }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (cause instanceof MultipartBodyInvalidError) {
    return new Response(JSON.stringify({ error: cause.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);

  if (session?.user) {
    if (session.user.emailVerified === false) {
      return redirect("/auth/verify-email");
    }
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
  let formData: FormData;
  try {
    formData = await readBoundedFormData(request, AUTH_FORM_BODY_MAX_BYTES);
  } catch (error) {
    const response = formBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
  const values = Object.fromEntries(formData);
  const input = {
    name: String(values.name || ""),
    email: String(values.email || ""),
    password: String(values.password || ""),
    confirmPassword: String(values.confirmPassword || ""),
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
    const authRequest = buildAuthSubRequest("/api/auth/sign-up/email", request, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        email: input.email,
        password: input.password,
        callbackURL: "/onboarding/student-id",
      }),
    });

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

    return redirect("/auth/verify-email");
  } catch (err: unknown) {
    const message = messageFromCause(err, "Sign up failed");
    return { formError: message };
  }
}

export default function RegisterPage() {
  const isLoading = useNavigation().state !== "idle";
  const { registrationDisabled } = useLoaderData() as {
    registrationDisabled: boolean;
  };
  const actionData = useActionData() as
    | {
        fieldErrors?: Partial<Record<keyof SignUpInput, string>>;
        formError?: string;
      }
    | undefined;

  return (
    <div
      className="min-h-svh flex flex-col items-center justify-center relative font-sans"
      style={{ background: "var(--muted)" }}
    >
      {/* Gold top bar */}
      <div
        className="fixed top-0 left-0 right-0 h-[3px] z-10"
        style={{ background: "var(--gold)" }}
      />

      {/* Logo */}
      <div className="flex items-center gap-2 mb-7">
        <div
          className="w-9 h-9 rounded-[9px] flex items-center justify-center"
          style={{ background: "var(--primary)" }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="1.75"
            strokeLinecap="round"
          >
            <path d="m3 9 9-5 9 5-9 5Z" />
            <path d="M6 11v4c3 3 9 3 12 0v-4" />
            <path d="M21 10v6" stroke="var(--gold)" />
            <circle cx="21" cy="18" r="1" fill="var(--gold)" stroke="none" />
          </svg>
        </div>
        <span
          className="text-xl font-bold"
          style={{ color: "var(--primary)", letterSpacing: "-0.01em" }}
        >
          EduAI
        </span>
      </div>

      {/* Card */}
      <div
        className="w-full max-w-[440px] mx-4 bg-card border rounded-[var(--radius-xl)] p-9 shadow-lg"
        style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}
      >
        {registrationDisabled ? (
          // §807: public registration is off — explain it's invite-only instead
          // of bouncing the user to /login with no context.
          <div className="flex flex-col items-center gap-4 text-center">
            <h1 className="text-lg font-semibold text-foreground">Registration is invite-only</h1>
            <p className="text-sm text-muted-foreground">
              New accounts on this platform are created by invitation. Ask your administrator or
              instructor to send you an invite, then use the link in that email to set up your
              account.
            </p>
            <Link
              to="/auth/login"
              className="text-sm text-primary-text underline underline-offset-4"
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

      <p className="mt-5 text-xs text-muted-foreground">
        University of British Columbia · EduAI Platform
      </p>
    </div>
  );
}
