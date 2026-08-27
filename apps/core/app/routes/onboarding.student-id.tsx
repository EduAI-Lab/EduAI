import { redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { StudentIdOnboardingForm } from "~/components/onboarding/student-id-onboarding-form";
import { LinkRosterError, linkCanvasRoster } from "~/lib/canvas/link-roster.server";
import {
  studentIdOnboardingSkipCookieHeader,
  userNeedsStudentIdOnboarding,
} from "~/lib/canvas/onboarding.server";
import { LinkRosterSchema } from "~/lib/canvas/schemas";
import { getRequestSession } from "~/lib/auth/request-session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);

  if (!session?.user) {
    return redirect("/auth/login");
  }

  const needsOnboarding = await userNeedsStudentIdOnboarding(session.user.id, session.user.role);

  if (!needsOnboarding) {
    return redirect("/dashboard");
  }

  return {
    userName: session.user.name,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const session = await getRequestSession(request);

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
    <div
      className="min-h-svh flex items-center justify-center relative font-sans"
      style={{ background: "var(--background)" }}
    >
      {/* Gold top bar */}
      <div
        className="fixed top-0 left-0 right-0 h-[3px] z-10"
        style={{ background: "var(--gold)" }}
      />

      {/* Logo (fixed top-left) */}
      <div className="fixed top-4 left-6 flex items-center gap-2">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ stroke: "var(--primary)" }}
        >
          <path d="m3 9 9-5 9 5-9 5Z" />
          <path d="M6 11v4c3 3 9 3 12 0v-4" />
          <path d="M21 10v6" stroke="var(--gold)" />
          <circle cx="21" cy="18" r="1" fill="var(--gold)" stroke="none" />
        </svg>
        <span className="text-[15px] font-bold" style={{ color: "var(--primary)" }}>
          EduAI
        </span>
      </div>

      <div className="w-full max-w-[460px] mx-4">
        {userName && (
          <p className="text-center text-sm text-muted-foreground mb-4">
            Welcome, <span className="font-medium text-foreground">{userName}</span>! One more step.
          </p>
        )}
        <StudentIdOnboardingForm
          formError={actionData?.formError}
          fieldError={actionData?.fieldError}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}
