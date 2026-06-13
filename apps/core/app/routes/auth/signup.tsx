import { Form, Link, useActionData, redirect } from "react-router";
import { signUp } from "~/lib/auth";
import { signUpSchema, type SignUpInput } from "~/lib/auth";
import type { ActionFunctionArgs } from "react-router";

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
    await signUp.email({
      email: input.email,
      password: input.password,
      name: input.name,
    });
    return redirect("/");
  } catch (err: unknown) {
    let message = "Sign up failed";
    if (typeof err === "object" && err && "message" in err) {
      message = String((err as { message?: string }).message ?? message);
    }
    return { formError: message };
  }
}

export default function SignUp() {
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
        <h2 className="text-center text-2xl font-bold text-foreground mb-6">
          Create your account
        </h2>

        <Form className="space-y-5" method="post">
          {actionData?.formError && (
            <p className="text-sm text-destructive text-center">{actionData.formError}</p>
          )}
          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-foreground mb-1">
                Full Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                className={`appearance-none block w-full px-3 py-2 border rounded-md text-sm text-foreground bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary ${
                  actionData?.fieldErrors?.name
                    ? "border-destructive focus:ring-destructive focus:border-destructive"
                    : "border-border"
                }`}
                placeholder="Enter your full name"
                autoComplete="name"
              />
              {actionData?.fieldErrors?.name && (
                <p className="mt-1 text-sm text-destructive">
                  {actionData.fieldErrors.name}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="email-address" className="block text-sm font-medium text-foreground mb-1">
                Email Address
              </label>
              <input
                id="email-address"
                name="email"
                type="email"
                autoComplete="email"
                required
                className={`appearance-none block w-full px-3 py-2 border rounded-md text-sm text-foreground bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary ${
                  actionData?.fieldErrors?.email
                    ? "border-destructive focus:ring-destructive focus:border-destructive"
                    : "border-border"
                }`}
                placeholder="Email address"
              />
              {actionData?.fieldErrors?.email && (
                <p className="mt-1 text-sm text-destructive">
                  {actionData.fieldErrors.email}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                className={`appearance-none block w-full px-3 py-2 border rounded-md text-sm text-foreground bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary ${
                  actionData?.fieldErrors?.password
                    ? "border-destructive focus:ring-destructive focus:border-destructive"
                    : "border-border"
                }`}
                placeholder="Password"
              />
              {actionData?.fieldErrors?.password && (
                <p className="mt-1 text-sm text-destructive">
                  {actionData.fieldErrors.password}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                Must be at least 8 characters
              </p>
            </div>
            <div>
              <label htmlFor="confirm-password" className="block text-sm font-medium text-foreground mb-1">
                Confirm Password
              </label>
              <input
                id="confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                className={`appearance-none block w-full px-3 py-2 border rounded-md text-sm text-foreground bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary ${
                  actionData?.fieldErrors?.confirmPassword
                    ? "border-destructive focus:ring-destructive focus:border-destructive"
                    : "border-border"
                }`}
                placeholder="Confirm password"
              />
              {actionData?.fieldErrors?.confirmPassword && (
                <p className="mt-1 text-sm text-destructive">
                  {actionData.fieldErrors.confirmPassword}
                </p>
              )}
            </div>
          </div>

          <button
            type="submit"
            className="w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-primary-foreground bg-primary hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-opacity"
          >
            Create account
          </button>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/auth/signin" className="font-medium text-primary hover:opacity-80">
              Sign in
            </Link>
          </p>
        </Form>
      </div>

      <p className="mt-5 text-xs text-muted-foreground">University of British Columbia · EduAI Platform</p>
    </div>
  );
}