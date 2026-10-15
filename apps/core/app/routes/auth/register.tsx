import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import { JoinCourseNotice } from "~/components/auth/join-course-notice";
import { RegisterForm } from "~/components/register-form";
import { redirectToStudentIdOnboardingIfNeeded } from "~/lib/canvas/onboarding.server";
import { signUpSchema, type SignUpInput } from "~/lib/auth";
import { buildAuthSubRequest } from "~/lib/auth/auth-handler-request";
import { auth } from "~/lib/auth/server";
import { formBodyErrorResponse, readAuthFormData } from "~/lib/auth/forms.server";
import { getPolicy } from "~/lib/policy.server";
import { messageFromCause } from "~/lib/form-errors";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { validateRedirectUrl } from "~/lib/auth/guards.server";
import { rememberPendingSelfEnrollmentForSignUp } from "~/lib/courses/pending-self-enrollment.server";
import {
  describeSelfEnrollmentLinkForVisitor,
  SELF_ENROLL_COMPLETE_PATH,
  selfEnrollmentTokenFromRedirect,
} from "~/lib/courses/self-enrollment.server";

const signUpResponseSchema = z.object({ user: z.object({ id: z.string() }) });

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
    return { registrationDisabled: true, joining: null, redirectTo: "" };
  }

  // #1961: arrived from a course join link via sign-in. Name the course and keep
  // the link for the action, which remembers the join once the account exists.
  const redirectTo = validateRedirectUrl(new URL(request.url).searchParams.get("redirect"));
  const joinToken = selfEnrollmentTokenFromRedirect(redirectTo);
  if (!joinToken) return { registrationDisabled: false, joining: null, redirectTo: "" };
  return {
    registrationDisabled: false,
    joining: await describeSelfEnrollmentLinkForVisitor(joinToken),
    redirectTo,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  let formData: FormData;
  try {
    formData = await readAuthFormData(request);
  } catch (error) {
    const response = formBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
  const values = Object.fromEntries(formData);
  // #1961: the course join link this sign-up started from, kept by the form.
  const joinToken = selfEnrollmentTokenFromRedirect(
    validateRedirectUrl(String(values.redirectTo || "")),
  );
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
        callbackURL: joinToken ? SELF_ENROLL_COMPLETE_PATH : "/onboarding/student-id",
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

    if (joinToken) {
      // Remembered against the new account and redeemed when the email is
      // verified, so the link need not survive the trip through the inbox.
      const signedUp = signUpResponseSchema.safeParse(await response.json().catch(() => null));
      if (signedUp.success) {
        await rememberPendingSelfEnrollmentForSignUp({
          userId: signedUp.data.user.id,
          email: input.email,
          token: joinToken,
        });
      }
    }

    return redirect("/auth/verify-email");
  } catch (err: unknown) {
    const message = messageFromCause(err, "Sign up failed");
    return { formError: message };
  }
}

export default function RegisterPage() {
  const isLoading = useNavigation().state !== "idle";
  const { registrationDisabled, joining, redirectTo } = useLoaderData() as {
    registrationDisabled: boolean;
    joining: { courseCode: string; courseName: string } | null;
    redirectTo: string;
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
          className="w-9 h-9 rounded-[9px] flex items-center justify-center dark:ring-1 dark:ring-white/40"
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
        <span className="text-xl font-bold text-primary dark:text-foreground">EduAI</span>
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
            {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}
            {joining && <JoinCourseNotice {...joining} action="sign-up" />}
            <RegisterForm
              fieldErrors={actionData?.fieldErrors}
              isLoading={isLoading}
              loginHref={
                redirectTo
                  ? `/auth/login?redirect=${encodeURIComponent(redirectTo)}`
                  : "/auth/login"
              }
            />
          </Form>
        )}
      </div>

      <p className="mt-5 text-xs text-muted-foreground">
        University of British Columbia · EduAI Platform
      </p>
    </div>
  );
}
