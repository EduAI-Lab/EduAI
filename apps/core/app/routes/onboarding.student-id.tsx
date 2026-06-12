import { GalleryVerticalEnd } from "lucide-react";
import { redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { StudentIdOnboardingForm } from "~/components/onboarding/student-id-onboarding-form";
import { LinkRosterError, linkCanvasRoster } from "~/lib/canvas/link-roster.server";
import {
  studentIdOnboardingSkipCookieHeader,
  userNeedsStudentIdOnboarding,
} from "~/lib/canvas/onboarding.server";
import { LinkRosterSchema } from "~/lib/canvas/schemas";
import { auth } from "~/lib/auth/server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);

  if (!session?.user) {
    return redirect("/auth/login");
  }

  const needsOnboarding = await userNeedsStudentIdOnboarding(
    session.user.id,
    session.user.role,
  );

  if (!needsOnboarding) {
    return redirect("/dashboard");
  }

  return {
    userName: session.user.name,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const session = await auth.api.getSession(request);

  if (!session?.user) {
    return redirect("/auth/login");
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "link");

  if (intent === "skip") {
    return redirect("/dashboard", {
      headers: { "Set-Cookie": studentIdOnboardingSkipCookieHeader() },
    });
  }

  const input = {
    studentNumber: String(formData.get("studentNumber") ?? ""),
  };
  const result = LinkRosterSchema.safeParse(input);

  if (!result.success) {
    const fieldError = result.error.issues[0]?.message ?? "Invalid student number";
    return { fieldError };
  }

  try {
    await linkCanvasRoster(session.user.id, result.data.studentNumber);
    return redirect("/dashboard");
  } catch (error) {
    if (error instanceof LinkRosterError) {
      return { formError: error.message };
    }
    throw error;
  }
}

export default function StudentIdOnboardingPage() {
  const { userName } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="/dashboard" className="flex items-center gap-2 font-medium">
            <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
              <GalleryVerticalEnd className="size-4" />
            </div>
            EduAI
          </a>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <p className="mb-6 text-center text-sm text-muted-foreground">
              Welcome{userName ? `, ${userName}` : ""}! One more step before you get started.
            </p>
            <StudentIdOnboardingForm
              formError={actionData?.formError}
              fieldError={actionData?.fieldError}
              isLoading={isLoading}
            />
          </div>
        </div>
      </div>
      <div className="bg-muted relative hidden lg:block">
        <img
          src="/placeholder.svg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
        />
      </div>
    </div>
  );
}
