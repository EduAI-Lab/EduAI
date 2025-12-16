import { Form, useActionData, redirect } from "react-router"
import { GalleryVerticalEnd } from "lucide-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"

import { RegisterForm } from "~/components/register-form"
import { signUpSchema, type SignUpInput } from "~/lib/auth"
import { auth } from "~/lib/auth/server"

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);

  if (session?.user) {
    return redirect("/dashboard");
  }

  return {};
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
    // Create a new request to the better-auth sign-up endpoint
    const url = new URL("/api/auth/sign-up/email", request.url);
    const authRequest = new Request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: input.name,
        email: input.email,
        password: input.password,
      }),
    });

    const response = await auth.handler(authRequest);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        formError: errorData.message || "Sign up failed"
      };
    }



    // Get the session cookie from the response
    const setCookie = response.headers.get("Set-Cookie");
    const headers = new Headers();
    if (setCookie) {
      headers.set("Set-Cookie", setCookie);
    }

    return redirect("/dashboard", { headers });
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
  const actionData = useActionData() as {
    fieldErrors?: Partial<Record<keyof SignUpInput, string>>;
    formError?: string;
  } | undefined;

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="#" className="flex items-center gap-2 font-medium">
            <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
              <GalleryVerticalEnd className="size-4" />
            </div>
            EduAI
          </a>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">
            <Form method="post">
              {actionData?.formError && (
                <div className="mb-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                  {actionData.formError}
                </div>
              )}
              <RegisterForm
                fieldErrors={actionData?.fieldErrors}
                isLoading={isLoading}
              />
            </Form>
          </div>
        </div>
      </div>
      <div className="bg-muted relative hidden lg:block">
        <img
          src="/placeholder.svg"
          alt="Image"
          className="absolute inset-0 h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
        />
      </div>
    </div>
  )
}