import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import { buildAuthSubRequest } from "~/lib/auth/auth-handler-request";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { auth } from "~/lib/auth/server";
import { isUbcEmail, UBC_EMAIL_MESSAGE } from "~/lib/auth/ubc-email";
import { formBodyErrorResponse, readAuthFormData } from "~/lib/auth/forms.server";

const VERIFICATION_CALLBACK_URL = "/onboarding/student-id";

const resendVerificationSchema = z.object({
  email: z
    .string()
    .trim()
    .max(320, "Email address is too long")
    .email("Please enter a valid email address")
    .refine(isUbcEmail, UBC_EMAIL_MESSAGE),
});

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);
  if (session?.user.emailVerified) return redirect(VERIFICATION_CALLBACK_URL);

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  const session = await getRequestSession(request);
  if (session?.user.emailVerified) return redirect(VERIFICATION_CALLBACK_URL);

  let formData: FormData;
  try {
    formData = await readAuthFormData(request);
  } catch (error) {
    const response = formBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }

  const result = resendVerificationSchema.safeParse({ email: formData.get("email") });
  if (!result.success) {
    return { fieldError: result.error.issues[0]?.message ?? "Please enter a valid email address" };
  }

  const resendRequest = buildAuthSubRequest("/api/auth/send-verification-email", request, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: result.data.email,
      callbackURL: VERIFICATION_CALLBACK_URL,
    }),
  });

  // Better Auth deliberately gives the same response for unknown, verified,
  // and unverified addresses. Keep transport and rate-limit failures generic
  // here too so this public form cannot become an account-enumeration oracle.
  await auth.handler(resendRequest).catch(() => null);

  return { sent: true };
}

export default function VerifyEmailPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  return (
    <div
      className="min-h-svh flex flex-col items-center justify-center relative font-sans"
      style={{ background: "var(--muted)" }}
    >
      <div
        className="fixed top-0 left-0 right-0 h-[3px] z-10"
        style={{ background: "var(--gold)" }}
      />
      <div className="w-full max-w-[440px] mx-4 bg-card border rounded-[var(--radius-xl)] p-9 shadow-lg text-center">
        <h1 className="text-2xl font-bold">Check your email</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Verify your email before linking your Canvas student number. If you need another link,
          enter the UBC email address you registered with.
        </p>

        {actionData && "sent" in actionData && actionData.sent && (
          <p className="mt-4 text-sm text-foreground" role="status">
            If an account with that email is awaiting verification, a new link has been sent.
          </p>
        )}
        {actionData && "fieldError" in actionData && actionData.fieldError && (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {actionData.fieldError}
          </p>
        )}

        <Form method="post" className="mt-6 text-left">
          <label htmlFor="verification-email" className="text-sm font-medium text-foreground">
            UBC email
          </label>
          <input
            id="verification-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="mt-2 flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 w-full items-center justify-center rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {isSubmitting ? "Sending…" : "Resend verification email"}
          </button>
        </Form>
        <Link
          to="/auth/login"
          className="mt-5 inline-block text-sm text-muted-foreground underline underline-offset-4"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
