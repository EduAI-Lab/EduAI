import { Form, Link, useActionData, useNavigate } from "react-router";
import { signIn } from "~/lib/auth";
import { signInSchema, type SignInInput } from "~/lib/auth";
import type { ActionFunctionArgs } from "react-router";
import { useEffect, useState } from "react";

export async function action({ request }: ActionFunctionArgs) {
  const formData = Object.fromEntries(await request.formData());
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

  // Return the validated data instead of performing the sign-in on the server
  // This allows the client to handle the authentication and session management
  return { validatedData: input };
}

export default function SignIn() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const actionData = useActionData() as {
    fieldErrors?: Partial<Record<keyof SignInInput, string>>;
    validatedData?: SignInInput;
  } | undefined;

  // Handle client-side sign-in when we have validated data
  useEffect(() => {
    if (actionData?.validatedData) {
      const performSignIn = async () => {
        setIsLoading(true);
        setAuthError("");
        try {
          await signIn.email({
            email: actionData.validatedData!.email,
            password: actionData.validatedData!.password,
          });
          navigate("/");
        } catch (err: unknown) {
          let message = "Sign in failed";
          if (typeof err === "object" && err && "message" in err) {
            message = String((err as { message?: string }).message ?? message);
          }
          setAuthError(message);
          setIsLoading(false);
        }
      };
      performSignIn();
    }
  }, [actionData?.validatedData, navigate]);

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
          Sign in to your account
        </h2>

        <Form className="space-y-5" method="post">
          {authError && (
            <p className="text-sm text-destructive text-center">{authError}</p>
          )}

          <div className="space-y-4">
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
                disabled={isLoading}
                className={`appearance-none block w-full px-3 py-2 border rounded-md text-sm text-foreground bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary ${
                  actionData?.fieldErrors?.email
                    ? "border-destructive focus:ring-destructive focus:border-destructive"
                    : "border-border"
                } ${isLoading ? "opacity-50 cursor-not-allowed" : ""}`}
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
                autoComplete="current-password"
                required
                disabled={isLoading}
                className={`appearance-none block w-full px-3 py-2 border rounded-md text-sm text-foreground bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary ${
                  actionData?.fieldErrors?.password
                    ? "border-destructive focus:ring-destructive focus:border-destructive"
                    : "border-border"
                } ${isLoading ? "opacity-50 cursor-not-allowed" : ""}`}
                placeholder="Password"
              />
              {actionData?.fieldErrors?.password && (
                <p className="mt-1 text-sm text-destructive">
                  {actionData.fieldErrors.password}
                </p>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-primary-foreground bg-primary hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {isLoading ? "Signing in..." : "Sign in"}
          </button>

          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link to="/auth/signup" className="font-medium text-primary hover:opacity-80">
              Sign up
            </Link>
          </p>
        </Form>
      </div>

      <p className="mt-5 text-xs text-muted-foreground">University of British Columbia · EduAI Platform</p>
    </div>
  );
}