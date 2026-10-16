import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

/**
 * The audit entry for a student joining a course through a self-enrollment link.
 *
 * Every other path that creates an enrollment logs it (the single-add route and
 * the CSV import both do), so a roster built from a shared link must not be the
 * one that is invisible when someone asks who joined this course and how.
 * `source` names the link so the answer is "and how"; `deferred` says the join
 * waited for the person to create and activate an account (#1961).
 */
export function logSelfEnrollmentRedeemed(input: {
  user: { id: string; role?: string | null };
  request: Request;
  enrollmentId: string;
  courseId: string;
  linkId: string;
  deferred: boolean;
}): void {
  fireAndForget(
    logAuditAction({
      ...getActorContext(input.user),
      ...getRequestContext(input.request),
      actionCode: "ENROLLMENT_ADDED",
      category: "ENROLLMENT",
      entityType: "Enrollment",
      entityId: input.enrollmentId,
      details: {
        courseId: input.courseId,
        role: "STUDENT",
        targetUserId: input.user.id,
        source: "SELF_ENROLLMENT_LINK",
        linkId: input.linkId,
        deferred: input.deferred,
      },
    }),
  );
}
