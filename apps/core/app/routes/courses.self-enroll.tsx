/**
 * /courses/self-enroll?token=… — the page a student opens from a shared
 * self-enrollment link (#1756).
 *
 * The loader only PREVIEWS the link: it says which course the token is for and
 * whether it is still usable, and writes nothing. Enrolling happens on the
 * POST, so simply opening the URL — or having a link-preview bot fetch it —
 * never joins anyone to a course and never burns a capped redemption.
 *
 * Its one other job is to redirect a student who is already in the course. That
 * is still read-only, and it is what makes the redeem path's idempotency
 * reachable: the 200 it answers for a returning student is only ever issued by
 * the Join button, which an error page does not render.
 */
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { IconStack2 } from "@tabler/icons-react";

import { Button } from "@eduai/ui";
import { getRequestSession } from "~/lib/auth/request-session.server";
import {
  previewSelfEnrollmentLink,
  redeemSelfEnrollmentLink,
} from "~/lib/courses/self-enrollment.server";
import { logSelfEnrollmentRedeemed } from "~/lib/courses/self-enrollment-audit.server";
import { friendlySelfEnrollmentError } from "~/lib/courses/self-enrollment-messages";

/**
 * Send an anonymous visitor to log in and come straight back here — token and
 * all. Without that round trip the student loses the link the moment they
 * authenticate, which for a one-off shared URL means losing it for good: the
 * raw token is shown to the instructor exactly once and cannot be re-read.
 *
 * The parameter name is load-bearing: `routes/auth/login.tsx` reads `redirect`
 * and nothing else, so any other spelling is silently dropped and lands the
 * student on `/dashboard`. `validateRedirectUrl` passes a relative path through
 * unchanged, query string included.
 */
function loginRedirect(request: Request): Response {
  const url = new URL(request.url);
  const redirectTo = `${url.pathname}${url.search}`;
  return redirect(`/auth/login?redirect=${encodeURIComponent(redirectTo)}`);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);
  if (!session?.user) return loginRedirect(request);

  const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
  if (token === "") {
    return {
      ok: false as const,
      error: "MISSING_TOKEN",
      message: friendlySelfEnrollmentError("MISSING_TOKEN"),
    };
  }

  const preview = await previewSelfEnrollmentLink(token, session.user.id);
  if (!preview.ok) {
    return {
      ok: false as const,
      error: preview.error,
      message: friendlySelfEnrollmentError(preview.error),
    };
  }
  // Already in the course — send them there instead of offering a Join they do
  // not need. This is also what keeps a student who joined in week one from
  // reading "this link has reached its limit" when they re-open the link from
  // the syllabus in week ten: the POST handles that case, but they would never
  // get to press the button that issues it. Read-only, as a loader must be.
  if (preview.alreadyEnrolled) {
    return redirect(`/courses/${preview.courseId}`);
  }
  return {
    ok: true as const,
    token,
    courseId: preview.courseId,
    courseCode: preview.courseCode,
    courseName: preview.courseName,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const session = await getRequestSession(request);
  if (!session?.user) return loginRedirect(request);

  const formData = await request.formData();
  const token = String(formData.get("token") ?? "").trim();

  const result = await redeemSelfEnrollmentLink({ token, userId: session.user.id });
  if (result.status === "201") {
    // Only on 201: a 200 means the student was already enrolled and this
    // request wrote nothing.
    logSelfEnrollmentRedeemed({
      user: session.user,
      request,
      enrollmentId: result.enrollmentId,
      courseId: result.courseId,
      linkId: result.linkId,
      deferred: false,
    });
  }
  if (result.status === "201" || result.status === "200") {
    // Both outcomes mean "you are in this course" — land the student on it
    // rather than making them read a confirmation they did not ask for.
    return redirect(`/courses/${result.courseId}`);
  }
  return {
    ok: false as const,
    error: result.error,
    message: friendlySelfEnrollmentError(result.error),
  };
}

export default function SelfEnrollPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const joining = navigation.state === "submitting";

  // A failed redemption supersedes a preview that looked fine a moment ago.
  const failure = actionData?.ok === false ? actionData : data.ok ? null : data;

  return (
    <main className="min-h-svh flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md flex flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-medium">
          <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
            <IconStack2 className="size-4" />
          </div>
          EduAI
        </div>

        {failure ? (
          <div className="rounded-lg border p-6 text-center space-y-2">
            <h1 className="text-lg font-semibold">Can&apos;t join this course</h1>
            <p className="text-sm text-muted-foreground">{failure.message}</p>
            {/* This page has no app shell, so without a link it is a dead end (#1939). */}
            <Button asChild variant="outline" className="mt-2">
              <Link to="/dashboard">Go to dashboard</Link>
            </Button>
          </div>
        ) : (
          data.ok && (
            <div className="rounded-lg border p-6 space-y-4">
              <div className="space-y-1">
                <h1 className="text-lg font-semibold">Join {data.courseCode}</h1>
                <p className="text-sm text-muted-foreground">{data.courseName}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                You&apos;ll be enrolled as a student and can ask about this course in course chat.
              </p>
              <Form method="post">
                <input type="hidden" name="token" value={data.token} />
                <Button type="submit" className="w-full" disabled={joining}>
                  {joining ? "Joining…" : "Join course"}
                </Button>
              </Form>
            </div>
          )
        )}
      </div>
    </main>
  );
}
