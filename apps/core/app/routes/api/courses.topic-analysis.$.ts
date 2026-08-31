import type { JsonValue } from "~/lib/json-value";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import { resolveCourseAccessGate } from "~/lib/auth/course-access.server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import {
  approveGeneratedTopic,
  dismissGeneratedTopic,
  latestTopicAnalysisForCourse,
  mergeGeneratedTopic,
  retryTopicAnalysis,
} from "~/lib/topics/review.server";

function json(body: JsonValue, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const topicId = z.string().min(1);

/**
 * The four bodies this action accepts. The "merge into itself" check lives in
 * the handler rather than a `.refine()` here: refining a member turns it into a
 * ZodEffects, which `discriminatedUnion` will not accept.
 */
const ReviewBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), topicId }),
  z.object({ action: z.literal("dismiss"), topicId }),
  z.object({ action: z.literal("merge"), topicId, intoTopicId: topicId }),
  z.object({ action: z.literal("retry") }),
]);

/**
 * `GET /api/courses/:courseId/topic-analysis` — the instructor-facing status of
 * automatic topic provisioning (#1624).
 *
 * The AiJob row IS the persistent notification: it survives reloads and
 * sessions, which a toast does not, and it carries the completion counts and the
 * failure message the banner needs. Staff-only — students have no reason to see
 * that a course's topics were machine-generated.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const courseId = params.courseId;
  if (!courseId) return json({ error: "Course ID is required" }, 400);

  const session = await getRequestSession(request);
  if (!session?.user) return json({ error: "Unauthorized" }, 401);

  const { course, access } = await resolveCourseAccessGate(session.user, courseId);
  if (!course) return json({ error: "COURSE_NOT_FOUND" }, 404);
  // rank >= 1 is TA and above: the same tier that can already see the topic
  // list as something they administer rather than something they consume.
  if (!access || access.rank < 1) return json({ error: "Forbidden" }, 403);

  return json(await latestTopicAnalysisForCourse(courseId));
}

/**
 * `POST /api/courses/:courseId/topic-analysis` — act on a generated topic.
 *
 * `{ action: "approve" | "dismiss", topicId }` or
 * `{ action: "merge", topicId, intoTopicId }` or `{ action: "retry" }`.
 *
 * Restricted to rank >= 2 (INSTRUCTOR and above). A TA is deliberately excluded
 * even under the `tas.canManageTopics` grant: merging repoints every question on
 * a topic, which is a heavier, less reversible action than the create/rename
 * that grant was written for.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const courseId = params.courseId;
  if (!courseId) return json({ error: "Course ID is required" }, 400);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const session = await getRequestSession(request);
  if (!session?.user) return json({ error: "Unauthorized" }, 401);

  const { course, access } = await resolveCourseAccessGate(session.user, courseId);
  if (!course) return json({ error: "COURSE_NOT_FOUND" }, 404);
  if (!access || access.rank < 2) return json({ error: "Forbidden" }, 403);

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const validation = ReviewBodySchema.safeParse(rawBody);
  if (!validation.success) return json({ error: "Invalid input" }, 400);
  const parsed = validation.data;

  const requestContext = getRequestContext(request);
  const actor = getActorContext(session.user);

  if (parsed.action === "retry") {
    const started = await retryTopicAnalysis(courseId, session.user.id);
    if (!started) return json({ error: "NO_ANALYZABLE_MATERIALS" }, 409);
    return json({ jobId: started.jobId });
  }

  if (parsed.action === "merge" && parsed.topicId === parsed.intoTopicId) {
    return json({ error: "Invalid input" }, 400);
  }

  const result =
    parsed.action === "approve"
      ? await approveGeneratedTopic(courseId, parsed.topicId)
      : parsed.action === "dismiss"
        ? await dismissGeneratedTopic(courseId, parsed.topicId, session.user.id)
        : await mergeGeneratedTopic(courseId, parsed.topicId, parsed.intoTopicId, session.user.id);

  if (result.status !== "200") {
    return json({ error: result.error }, Number(result.status));
  }

  // Built in two statements rather than a conditional spread so the merge
  // target is present only when there is one.
  const details =
    parsed.action === "merge" ? { courseId, intoTopicId: parsed.intoTopicId } : { courseId };

  fireAndForget(
    logAuditAction({
      ...actor,
      ...requestContext,
      actionCode:
        parsed.action === "approve"
          ? "TOPIC_SUGGESTION_APPROVED"
          : parsed.action === "dismiss"
            ? "TOPIC_SUGGESTION_DISMISSED"
            : "TOPIC_SUGGESTION_MERGED",
      category: "TOPIC",
      entityType: "CourseTopic",
      entityId: parsed.topicId,
      entityLabel: result.topic.name,
      details,
    }),
  );

  return json({ topic: result.topic });
}
