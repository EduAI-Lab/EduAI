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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to your account
          </h2>
        </div>
        <Form className="mt-8 space-y-6" method="post">
          {authError && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
              {authError}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="email-address" className="block text-sm font-medium text-gray-700">
                Email Address
              </label>
              <input
                id="email-address"
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={isLoading}
                className={`mt-1 appearance-none relative block w-full px-3 py-2 border placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm ${
                  actionData?.fieldErrors?.email
                    ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                    : "border-gray-300"
                } ${isLoading ? "opacity-50 cursor-not-allowed" : ""}`}
                placeholder="Email address"
              />
              {actionData?.fieldErrors?.email && (
                <p className="mt-1 text-sm text-red-600">
                  {actionData.fieldErrors.email}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={isLoading}
                className={`mt-1 appearance-none relative block w-full px-3 py-2 border placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm ${
                  actionData?.fieldErrors?.password
                    ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                    : "border-gray-300"
                } ${isLoading ? "opacity-50 cursor-not-allowed" : ""}`}
                placeholder="Password"
              />
              {actionData?.fieldErrors?.password && (
                <p className="mt-1 text-sm text-red-600">
                  {actionData.fieldErrors.password}
                </p>
              )}
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? "Signing in..." : "Sign in"}
            </button>
          </div>

          <div className="text-center">
            <Link
              to="/auth/signup"
              className="font-medium text-indigo-600 hover:text-indigo-500"
            >
              Don't have an account? Sign up
            </Link>
          </div>
        </Form>
      </div>
    </div>
  );
}