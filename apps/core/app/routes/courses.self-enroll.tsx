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
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { IconStack2 } from "@tabler/icons-react";

import { Button } from "@eduai/ui";
import { getRequestSession } from "~/lib/auth/request-session.server";
import {
  previewSelfEnrollmentLink,
  redeemSelfEnrollmentLink,
} from "~/lib/courses/self-enrollment.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

/**
 * A `Map` because the code arrives as a plain string from the library's result
 * union; an unrecognised one falls back to the generic message rather than
 * rendering a raw error code at a student.
 */
const ERROR_MESSAGES = new Map<string, string>([
  ["MISSING_TOKEN", "This enrollment link is missing its token."],
  ["INVALID_TOKEN", "This enrollment link is not valid."],
  ["COURSE_MISMATCH", "This enrollment link belongs to a different course."],
  ["COURSE_NOT_FOUND", "The course for this link no longer exists."],
  [
    "COURSE_NOT_PUBLISHED",
    "This course is not open to students yet. Try again once your instructor publishes it.",
  ],
  ["LINK_REVOKED", "This enrollment link was turned off. Ask your instructor for a new one."],
  ["LINK_EXPIRED", "This enrollment link has expired. Ask your instructor for a new one."],
  [
    "LINK_EXHAUSTED",
    "This enrollment link has reached its limit. Ask your instructor for a new one.",
  ],
]);

function friendlyError(code: string): string {
  return ERROR_MESSAGES.get(code) ?? "Something went wrong with this enrollment link.";
}

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
    return { ok: false as const, error: "MISSING_TOKEN", message: friendlyError("MISSING_TOKEN") };
  }

  const preview = await previewSelfEnrollmentLink(token, session.user.id);
  if (!preview.ok) {
    return { ok: false as const, error: preview.error, message: friendlyError(preview.error) };
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
    // Every other path that creates an enrollment logs it — the single-add
    // route and the CSV import both do — so a roster built from a shared link
    // must not be the one that is invisible when someone asks who joined this
    // course and how. `source` names the link so the answer is "and how".
    // Only on 201: a 200 means the student was already enrolled and this
    // request wrote nothing.
    fireAndForget(
      logAuditAction({
        ...getActorContext(session.user),
        ...getRequestContext(request),
        actionCode: "ENROLLMENT_ADDED",
        category: "ENROLLMENT",
        entityType: "Enrollment",
        entityId: result.enrollmentId,
        details: {
          courseId: result.courseId,
          role: "STUDENT",
          targetUserId: session.user.id,
          source: "SELF_ENROLLMENT_LINK",
          linkId: result.linkId,
        },
      }),
    );
  }
  if (result.status === "201" || result.status === "200") {
    // Both outcomes mean "you are in this course" — land the student on it
    // rather than making them read a confirmation they did not ask for.
    return redirect(`/courses/${result.courseId}`);
  }
  return { ok: false as const, error: result.error, message: friendlyError(result.error) };
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
          </div>
        ) : (
          data.ok && (
            <div className="rounded-lg border p-6 space-y-4">
              <div className="space-y-1">
                <h1 className="text-lg font-semibold">Join {data.courseCode}</h1>
                <p className="text-sm text-muted-foreground">{data.courseName}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                You&apos;ll be enrolled as a student and will be able to see this course&apos;s
                materials and chat.
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
