/**
 * /courses/self-enroll/complete: where a course join that waited for sign-up
 * lands (#1961).
 *
 * The verification email of an account registered from a join link points here,
 * and so does a sign-in that just finished such a join. The join itself has
 * usually happened already, when the email was verified. This page reports it:
 * into the course when it worked, the reason when the link expired, was turned
 * off or filled up in the meantime.
 *
 * Unlike /courses/self-enroll, this loader may redeem. That page takes a token
 * any link-preview bot can fetch, so its GET must write nothing. This one takes
 * no token and only finishes joins the signed-in person started themselves:
 * the same ones verification already tried, retried if that attempt failed.
 */
import { Link, redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { IconStack2 } from "@tabler/icons-react";

import { Button } from "@eduai/ui";
import { getRequestSession } from "~/lib/auth/request-session.server";
import {
  recentPendingSelfEnrollmentOutcome,
  redeemPendingSelfEnrollments,
} from "~/lib/courses/pending-self-enrollment.server";
import { SELF_ENROLL_COMPLETE_PATH } from "~/lib/courses/self-enrollment.server";
import { friendlySelfEnrollmentError } from "~/lib/courses/self-enrollment-messages";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);
  if (!session?.user) {
    // Opening a verification link a second time (mail scanners often open it
    // first) verifies nothing and signs nobody in. The outcome waits here.
    return redirect(`/auth/login?redirect=${encodeURIComponent(SELF_ENROLL_COMPLETE_PATH)}`);
  }

  await redeemPendingSelfEnrollments(session.user, request);
  const outcome = await recentPendingSelfEnrollmentOutcome(session.user.id);
  // No join to report (a resent verification email for an ordinary sign-up):
  // carry on where verification has always gone.
  if (!outcome) return redirect("/onboarding/student-id");
  if (outcome.joined) return redirect(`/courses/${outcome.courseId}`);
  return { courseCode: outcome.courseCode, message: friendlySelfEnrollmentError(outcome.outcome) };
}

export default function SelfEnrollCompletePage() {
  const { courseCode, message } = useLoaderData<typeof loader>();

  return (
    <main className="min-h-svh flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md flex flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-medium">
          <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
            <IconStack2 className="size-4" />
          </div>
          EduAI
        </div>
        <div className="rounded-lg border p-6 text-center space-y-2">
          <h1 className="text-lg font-semibold">Can&apos;t join {courseCode}</h1>
          <p className="text-sm text-muted-foreground">{message}</p>
          {/* No app shell here either, so without a link it is a dead end (#1939). */}
          <Button asChild variant="outline" className="mt-2">
            <Link to="/dashboard">Go to dashboard</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
