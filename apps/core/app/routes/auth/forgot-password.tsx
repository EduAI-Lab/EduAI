import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import type { ActionFunctionArgs } from "react-router";

import { buildAuthSubRequest } from "~/lib/auth/auth-handler-request";
import { formBodyErrorResponse, readAuthFormData } from "~/lib/auth/forms.server";
import { checkRateLimit, parseEnvInt } from "~/lib/auth/rate-limit.server";
import { forgotPasswordSchema, PASSWORD_RESET_OTP_LENGTH } from "~/lib/auth/schemas";
import { auth } from "~/lib/auth/server";
import { getRequestContext } from "~/lib/request-context.server";

const MAX_EMAIL_LENGTH = 320;

/**
 * #1728: this action makes the server send mail to an address the caller
 * names, so it is throttled on both sides of that pair — the IP doing the
 * asking, and the mailbox being aimed at. Better Auth's own limiter only
 * covers the former. Defaults are per 15 minutes; overridable per deployment.
 */
function passwordResetRequestLimits() {
  return {
    windowMs: parseEnvInt(process.env.PASSWORD_RESET_RATE_LIMIT_WINDOW_MS, 15 * 60_000),
    perEmail: parseEnvInt(process.env.PASSWORD_RESET_RATE_LIMIT_PER_EMAIL, 3),
    perIp: parseEnvInt(process.env.PASSWORD_RESET_RATE_LIMIT_PER_IP, 10),
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

  const submitted = String(formData.get("email") ?? "").trim();
  if (submitted.length > MAX_EMAIL_LENGTH) {
    return { fieldError: "Email address is too long" };
  }

  const result = forgotPasswordSchema.safeParse({ email: submitted });
  if (!result.success) {
    return { fieldError: result.error.issues[0]?.message ?? "Please enter a valid email address" };
  }
  const email = result.data.email.toLowerCase();

  // Charged before anything looks the address up, so the throttle can never
  // become the thing that tells an attacker an account exists.
  const { windowMs, perEmail, perIp } = passwordResetRequestLimits();
  const ipAddress = getRequestContext(request).ipAddress ?? "unknown";
  const byIp = await checkRateLimit(`password-reset-request:ip:${ipAddress}`, perIp, windowMs);
  if (byIp.limited) return { retryAfter: byIp.retryAfter };
  const byEmail = await checkRateLimit(`password-reset-request:email:${email}`, perEmail, windowMs);
  if (byEmail.limited) return { retryAfter: byEmail.retryAfter };

  const otpRequest = buildAuthSubRequest("/api/auth/email-otp/request-password-reset", request, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  // Better Auth deliberately gives the same response for unknown and known
  // addresses. Keep transport and rate-limit failures generic here too so this
  // public form cannot become an account-enumeration oracle.
  await auth.handler(otpRequest).catch(() => null);

  // Always the same redirect, for every address. The reset page phrases it as
  // a conditional ("if an account exists"), because that is all we may say.
  return redirect(`/auth/reset-password?email=${encodeURIComponent(email)}`);
}

function retryMessage(retryAfter: number): string {
  const minutes = Math.ceil(retryAfter / 60);
  if (minutes <= 1) return "Too many reset requests. Try again in about a minute.";
  return `Too many reset requests. Try again in about ${minutes} minutes.`;
}

export default function ForgotPasswordPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const fieldError = actionData && "fieldError" in actionData ? actionData.fieldError : null;
  const retryAfter = actionData && "retryAfter" in actionData ? actionData.retryAfter : null;

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
        <h1 className="text-2xl font-bold">Forgot your password?</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Enter the email address you sign in with. If it belongs to an EduAI account, we will email
          you a {PASSWORD_RESET_OTP_LENGTH}-digit code to set a new password.
        </p>

        {fieldError && (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {fieldError}
          </p>
        )}
        {retryAfter !== null && retryAfter !== undefined && (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {retryMessage(retryAfter)}
          </p>
        )}

        <Form method="post" className="mt-6 text-left">
          <label htmlFor="forgot-email" className="text-sm font-medium text-foreground">
            Email
          </label>
          <input
            id="forgot-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={MAX_EMAIL_LENGTH}
            className="mt-2 flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 w-full items-center justify-center rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {isSubmitting ? "Sending…" : "Email me a code"}
          </button>
        </Form>

        <div className="mt-5 flex flex-col gap-2">
          <Link
            to="/auth/reset-password"
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            I already have a code
          </Link>
          <Link
            to="/auth/login"
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
