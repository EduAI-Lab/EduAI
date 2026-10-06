import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import { buildAuthSubRequest } from "~/lib/auth/auth-handler-request";
import { formBodyErrorResponse, readAuthFormData } from "~/lib/auth/forms.server";
import {
  PASSWORD_RESET_OTP_LENGTH,
  resetPasswordOtpSchema,
  type ResetPasswordOtpInput,
} from "~/lib/auth/schemas";
import { auth } from "~/lib/auth/server";

const authErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
});

/** Any answer that means "that code will not work" reads the same way. */
const BAD_CODE_MESSAGE = "That code is not valid or has expired. Request a new one and try again.";

/**
 * Better Auth's own wording for a bad code leaks nothing, but it is written
 * for developers ("Invalid OTP"). Restate the ones a person can hit; anything
 * else — including this app's own password-policy and reuse errors, which the
 * caller can only reach by holding a live code — is passed through as-is.
 */
function messageForAuthError(code: string | undefined, message: string | undefined): string {
  switch (code) {
    case "INVALID_OTP":
    case "OTP_EXPIRED":
    // Reachable only with a live code for an address whose account went away
    // between the two steps; say no more than the bad-code case does.
    case "USER_NOT_FOUND":
      return BAD_CODE_MESSAGE;
    case "TOO_MANY_ATTEMPTS":
      return "Too many incorrect codes were entered. Request a new code and try again.";
    default:
      return message || BAD_CODE_MESSAGE;
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const email = new URL(request.url).searchParams.get("email")?.trim().slice(0, 320) ?? "";
  return { email };
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

  const result = resetPasswordOtpSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    otp: String(formData.get("otp") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });
  if (!result.success) {
    const fieldErrors: Partial<Record<keyof ResetPasswordOtpInput, string>> = {};
    result.error.issues.forEach((issue) => {
      // SAFETY: every issue this schema can raise is keyed on one of its own
      // top-level fields, so `path[0]` is a key of the input (or undefined,
      // which the guard below drops).
      const field = issue.path[0] as keyof ResetPasswordOtpInput;
      if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
    });
    return { fieldErrors };
  }

  const resetRequest = buildAuthSubRequest("/api/auth/email-otp/reset-password", request, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: result.data.email.toLowerCase(),
      otp: result.data.otp,
      password: result.data.password,
    }),
  });

  let response: Response;
  try {
    response = await auth.handler(resetRequest);
  } catch {
    return { formError: "Could not reset your password. Please try again." };
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const parsed = authErrorSchema.safeParse(payload);
    const error = parsed.success ? parsed.data : {};
    return { formError: messageForAuthError(error.code, error.message) };
  }

  // No session is issued here on purpose: proving control of the mailbox
  // earns a new password, not a signed-in browser.
  return { success: true };
}

export default function ResetPasswordPage() {
  const { email } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  const fieldErrors =
    actionData && "fieldErrors" in actionData ? (actionData.fieldErrors ?? {}) : {};
  const formError = actionData && "formError" in actionData ? actionData.formError : null;
  const succeeded = Boolean(actionData && "success" in actionData && actionData.success);

  return (
    <div
      className="min-h-svh flex flex-col items-center justify-center relative font-sans"
      style={{ background: "var(--muted)" }}
    >
      <div
        className="fixed top-0 left-0 right-0 h-[3px] z-10"
        style={{ background: "var(--gold)" }}
      />
      <div className="w-full max-w-[440px] mx-4 bg-card border rounded-[var(--radius-xl)] p-9 shadow-lg">
        {succeeded ? (
          <div className="text-center">
            <h1 className="text-2xl font-bold">Password updated</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Your new password is ready. Sign in with it to continue.
            </p>
            <Link
              to="/auth/login"
              className="mt-6 bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 w-full items-center justify-center rounded-md px-4 py-2 text-sm font-medium"
            >
              Continue to sign in
            </Link>
          </div>
        ) : (
          <>
            <div className="text-center">
              <h1 className="text-2xl font-bold">Set a new password</h1>
              <p className="mt-3 text-sm text-muted-foreground">
                If an EduAI account exists for {email || "that address"}, we emailed it a{" "}
                {PASSWORD_RESET_OTP_LENGTH}-digit code. Enter the code and choose a new password.
              </p>
            </div>

            {formError && (
              <p className="mt-4 text-sm text-destructive text-center" role="alert">
                {formError}
              </p>
            )}

            <Form method="post" className="mt-6 flex flex-col gap-4">
              <div>
                <label htmlFor="reset-email" className="text-sm font-medium text-foreground">
                  Email
                </label>
                <input
                  id="reset-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  defaultValue={email}
                  maxLength={320}
                  className="mt-2 flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
                />
                {fieldErrors.email && (
                  <p className="mt-1 text-sm text-destructive">{fieldErrors.email}</p>
                )}
              </div>

              <div>
                <label htmlFor="reset-otp" className="text-sm font-medium text-foreground">
                  Code from your email
                </label>
                <input
                  id="reset-otp"
                  name="otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  maxLength={PASSWORD_RESET_OTP_LENGTH}
                  className="mt-2 flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm tracking-[0.3em]"
                />
                {fieldErrors.otp && (
                  <p className="mt-1 text-sm text-destructive">{fieldErrors.otp}</p>
                )}
              </div>

              <div>
                <label htmlFor="reset-password" className="text-sm font-medium text-foreground">
                  New password
                </label>
                <input
                  id="reset-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  className="mt-2 flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
                />
                {fieldErrors.password && (
                  <p className="mt-1 text-sm text-destructive">{fieldErrors.password}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="reset-confirm-password"
                  className="text-sm font-medium text-foreground"
                >
                  Confirm new password
                </label>
                <input
                  id="reset-confirm-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  className="mt-2 flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
                />
                {fieldErrors.confirmPassword && (
                  <p className="mt-1 text-sm text-destructive">{fieldErrors.confirmPassword}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 w-full items-center justify-center rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {isSubmitting ? "Saving…" : "Set new password"}
              </button>
            </Form>

            <div className="mt-5 flex flex-col gap-2 text-center">
              <Link
                to="/auth/forgot-password"
                className="text-sm text-muted-foreground underline underline-offset-4"
              >
                Send me a new code
              </Link>
              <Link
                to="/auth/login"
                className="text-sm text-muted-foreground underline underline-offset-4"
              >
                Back to sign in
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
