import prisma from "~/lib/prisma.server";
import { ensureCourseHasTopic } from "~/lib/topics/fallback.server";
import {
  recordTopicAnalysisJobs,
  resumeStaleTopicAnalysisJobs,
  runTopicAnalysisJob,
} from "~/lib/topics/job.server";

/** Shape returned by the topic-analysis status endpoint. */
export type TopicAnalysisStatus = {
  job: {
    id: string;
    status: string;
    errorMessage: string | null;
    createdAt: string;
    completedAt: string | null;
    created: number | null;
    usedSource: string | null;
  } | null;
  /** How many generated topics are still awaiting review. */
  pendingSuggestions: number;
};

type ReviewOutcome =
  | { status: "200"; topic: { id: string; name: string } }
  | { status: "404" | "409"; error: string };

/**
 * Latest topic-analysis job for a course, plus the outstanding suggestion count.
 *
 * The job row is the persistent notification (#1624): a banner reading it
 * survives reloads and new sessions, which is what "persistent" has to mean for
 * an instructor who kicked off a sync and closed the tab.
 */
export async function latestTopicAnalysisForCourse(courseId: string): Promise<TopicAnalysisStatus> {
  // Repair before reporting. A job whose process died between writing its row
  // and finishing the work has nothing else to notice it — there is no worker
  // pool or cron here — so the status read doubles as the recovery trigger,
  // which is exactly when an instructor is watching a banner that would
  // otherwise say "in progress" forever. Lease-guarded, so a healthy run is
  // never disturbed.
  await resumeStaleTopicAnalysisJobs(courseId);

  const [job, pendingSuggestions] = await Promise.all([
    prisma.aiJob.findFirst({
      where: { courseId, kind: "topic-analysis" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        errorMessage: true,
        createdAt: true,
        completedAt: true,
        result: true,
      },
    }),
    prisma.courseTopic.count({
      where: { courseId, deletedAt: null, reviewStatus: "SUGGESTED" },
    }),
  ]);

  if (!job) return { job: null, pendingSuggestions };

  const result = (job.result ?? null) as { created?: unknown; usedSource?: unknown } | null;

  return {
    job: {
      id: job.id,
      status: job.status,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
      created: typeof result?.created === "number" ? result.created : null,
      usedSource: typeof result?.usedSource === "string" ? result.usedSource : null,
    },
    pendingSuggestions,
  };
}

/**
 * Load a live topic that is still awaiting review.
 *
 * Every review action goes through this, so none of them can touch a topic the
 * job did not generate — the "never rename, delete, or merge human-created
 * topics automatically" rule holds for the review endpoints too, not just for
 * the generator.
 */
async function findSuggestion(courseId: string, topicId: string) {
  return prisma.courseTopic.findFirst({
    where: { id: topicId, courseId, deletedAt: null, reviewStatus: "SUGGESTED" },
    select: { id: true, name: true },
  });
}

/** Accept a generated topic as-is: it stops being a suggestion. */
export async function approveGeneratedTopic(
  courseId: string,
  topicId: string,
): Promise<ReviewOutcome> {
  const topic = await findSuggestion(courseId, topicId);
  if (!topic) return { status: "404", error: "TOPIC_NOT_FOUND" };

  const updated = await prisma.courseTopic.update({
    where: { id: topic.id },
    data: { reviewStatus: "ACCEPTED" },
    select: { id: true, name: true },
  });
  return { status: "200", topic: updated };
}

/**
 * Reject a generated topic. Soft-deleted rather than hard-deleted, deliberately:
 * the generator compares candidates against soft-deleted names too, so the
 * dismissal is what stops the same topic being proposed again on every resync.
 */
export async function dismissGeneratedTopic(
  courseId: string,
  topicId: string,
  userId: string,
): Promise<ReviewOutcome> {
  const topic = await findSuggestion(courseId, topicId);
  if (!topic) return { status: "404", error: "TOPIC_NOT_FOUND" };

  // Both relations count. A question that merely *tags* this topic is still a
  // question referencing it, and dismissing underneath it would leave that tag
  // pointing at a soft-deleted row — the same orphaning the primary check
  // exists to prevent, just one relation over.
  const [questionCount, secondaryCount] = await Promise.all([
    prisma.question.count({ where: { topicId: topic.id, deletedAt: null } }),
    prisma.questionSecondaryTopic.count({
      where: { topicId: topic.id, question: { deletedAt: null } },
    }),
  ]);
  if (questionCount > 0 || secondaryCount > 0) {
    // Dismissing would orphan authored questions. Merge is the operation that
    // handles this case; refuse rather than silently take one of its behaviours.
    return { status: "409", error: "TOPIC_HAS_QUESTIONS" };
  }

  const updated = await prisma.courseTopic.update({
    where: { id: topic.id },
    data: { deletedAt: new Date(), deletedBy: userId },
    select: { id: true, name: true },
  });

  // Dismissing the course's last live topic would leave Question Maker with
  // nothing to author against, which is the exact state the fallback exists to
  // prevent — so the invariant is re-established here too, not only after a job.
  await ensureCourseHasTopic(courseId);

  return { status: "200", topic: updated };
}

/**
 * Fold a generated topic into another topic on the same course: every question
 * that referenced it is repointed, then the source is dismissed.
 *
 * Run in a transaction because the two halves are meaningless apart — a
 * repointing without the soft delete leaves a duplicate empty topic, and a soft
 * delete without the repointing strands questions on a deleted topic.
 */
export async function mergeGeneratedTopic(
  courseId: string,
  topicId: string,
  intoTopicId: string,
  userId: string,
): Promise<ReviewOutcome> {
  const topic = await findSuggestion(courseId, topicId);
  if (!topic) return { status: "404", error: "TOPIC_NOT_FOUND" };

  const target = await prisma.courseTopic.findFirst({
    where: { id: intoTopicId, courseId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!target) return { status: "404", error: "TARGET_TOPIC_NOT_FOUND" };

  await prisma.$transaction(async (tx) => {
    await tx.question.updateMany({
      where: { topicId: topic.id },
      data: { topicId: target.id },
    });

    await repointSecondaryLinks(tx, topic.id, target.id);

    await tx.courseTopic.update({
      where: { id: topic.id },
      data: { deletedAt: new Date(), deletedBy: userId },
    });
  });

  return { status: "200", topic: target };
}

/** The transactional client `mergeGeneratedTopic` hands to its helpers. */
type TopicTransaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Move every secondary tag off the source topic and onto the target.
 *
 * Secondary tags are the question's *other* topics, and a merge has to carry
 * them across like the primary — dropping them, as this used to, silently
 * discarded a categorisation the author made. Only genuinely redundant links are
 * deleted, and there are exactly two kinds:
 *
 *   - the question already tags the target, so repointing would collide on the
 *     `@@id([questionId, topicId])` key; and
 *   - the target is now the question's primary topic, which makes a secondary
 *     tag naming it a self-reference rather than a second topic.
 *
 * Everything else is repointed, so the tag survives the merge.
 */
async function repointSecondaryLinks(
  tx: TopicTransaction,
  sourceTopicId: string,
  targetTopicId: string,
): Promise<void> {
  const links = await tx.questionSecondaryTopic.findMany({
    where: { topicId: sourceTopicId },
    select: { questionId: true },
  });
  if (links.length === 0) return;

  const questionIds = links.map((link) => link.questionId);

  const [alreadyTagged, primaryOnTarget] = await Promise.all([
    tx.questionSecondaryTopic.findMany({
      where: { topicId: targetTopicId, questionId: { in: questionIds } },
      select: { questionId: true },
    }),
    // Read after the primary repoint above, so this covers both a question that
    // already sat on the target and one this merge just moved there.
    tx.question.findMany({
      where: { id: { in: questionIds }, topicId: targetTopicId },
      select: { id: true },
    }),
  ]);

  const redundant = new Set<string>([
    ...alreadyTagged.map((row) => row.questionId),
    ...primaryOnTarget.map((row) => row.id),
  ]);

  if (redundant.size > 0) {
    await tx.questionSecondaryTopic.deleteMany({
      where: { topicId: sourceTopicId, questionId: { in: [...redundant] } },
    });
  }

  await tx.questionSecondaryTopic.updateMany({
    where: { topicId: sourceTopicId },
    data: { topicId: targetTopicId },
  });
}

/**
 * Re-run analysis for a course after a failure.
 *
 * Re-derives the batch from the course's READY materials rather than reusing the
 * failed job's payload, so a retry also picks up anything that finished
 * processing in the meantime. A retry of an unchanged corpus hashes to the same
 * idempotency key and is therefore a no-op — which is correct, and why the
 * failed row is cleared first so the retry can claim a fresh PENDING one.
 */
export async function retryTopicAnalysis(
  courseId: string,
  userId: string,
): Promise<{ jobId: string } | null> {
  const materials = await prisma.courseMaterial.findMany({
    where: { courseId, status: "READY", deletedAt: null },
    select: { id: true },
  });
  if (materials.length === 0) return null;

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { externalId: true, externalSource: true },
  });

  // Drop the terminal row for this batch so `recordTopicAnalysisJob` can mint a
  // fresh PENDING one under the same idempotency key. Only FAILED rows are
  // cleared: a COMPLETED batch has already produced its topics, and re-running
  // it would just re-propose names the instructor may have already dismissed.
  await prisma.aiJob.deleteMany({
    where: { courseId, kind: "topic-analysis", status: "FAILED" },
  });

  const recorded = await recordTopicAnalysisJobs({
    courseId,
    userId,
    materialIds: materials.map((material) => material.id),
    canvasCourseId: course?.externalSource === "canvas" ? course.externalId : null,
  });
  if (recorded.length === 0) return null;

  for (const job of recorded) {
    // A row still held by a live runner is left alone; a new one, or one
    // abandoned past its lease, is started here.
    if (!job.created && !job.resumable) continue;
    void runTopicAnalysisJob(job.jobId).catch((cause: unknown) => {
      console.error("[topic-analysis] retry run crashed", cause);
    });
  }

  // A large corpus splits into several rows; the banner tracks the newest, and
  // the first chunk's id is the stable handle to report back.
  return { jobId: recorded[0].jobId };
}
