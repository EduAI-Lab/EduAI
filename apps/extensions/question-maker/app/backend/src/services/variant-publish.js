/**
 * Publishing an approved variant to Core: push, link, and roll the approval
 * back when the push fails. Shared by both routes that can produce an approved
 * variant — approving an existing one (PUT) and creating one already reviewed
 * (POST) — so the two cannot drift. A variant left approved with no
 * `coreQuestionId` is `approvalInFlight` and can never be reverted, which is
 * exactly the stranding this centralisation exists to prevent.
 *
 * Returns a result the route turns into a response; it never touches `res`.
 */
import { prisma } from "../config/database.js";
import { logger } from "../utils/logger.js";
import { patchQuestionTestableOnCore } from "./coreApiService.js";
import { pushVariantToCore } from "./coreWiringService.js";
import { linkVariantToCore, rollbackVariantApproval } from "./questionService.js";
import { shouldPushApprovedVariantToCore } from "./variant-push-gate.js";

/**
 * @returns {Promise<{ outcome: string, coreQuestionId?: string, deletedTopicIds?: string[] }>}
 *   `skipped`  — nothing to publish (still a draft, already linked, or no Core course)
 *   `linked`   — pushed and linked; `coreQuestionId` is set
 *   `conflict` — another writer moved the row first; the pushed Core row was withdrawn
 *   `invalid-topics` / `duplicate-topic` — Core rejected the topic set
 *   `rollback-failed` — push failed AND the approval could not be undone
 *   `orphaned-core-question` — the Core row was created but could neither be
 *     linked nor withdrawn; `coreQuestionId` names the row left behind
 *   `push-failed` — push failed, approval rolled back to draft
 */
export async function publishApprovedVariant({ variant, ownerId, cookie }) {
  if (!shouldPushApprovedVariantToCore(variant)) return { outcome: "skipped" };

  const course = variant.questionMetadata?.course;
  if (!course?.coreCourseId) return { outcome: "skipped" };

  // Set the moment the push resolves. Everything after that point has to undo
  // the Core row it created: the row is live and `testable` may be true, while
  // nothing local points at it. The idempotency key hashes `testable`, so a
  // retry with a different share choice mints a *second* row rather than
  // replaying this one, leaving the first shared forever (#1652 review).
  let pushedCoreQuestionId = null;

  try {
    const pushResult = await pushVariantToCore(variant, course, cookie);
    pushedCoreQuestionId = pushResult.coreQuestionId;
    const linkResult = await linkVariantToCore(
      variant.id,
      ownerId,
      variant,
      pushResult.coreQuestionId,
    );
    if (!linkResult.applied) {
      // The row moved under us, so this Core question will never be linked.
      // (`applied` is true when the concurrent writer happened to link this
      // very id, so withdrawing here can never disown a live link.)
      const compensation = await withdrawVariantFromCore(pushedCoreQuestionId);
      if (compensation.outcome === "failed") {
        return { outcome: "orphaned-core-question", coreQuestionId: pushedCoreQuestionId };
      }
      return { outcome: "conflict" };
    }
    return { outcome: "linked", coreQuestionId: linkResult.variant.coreQuestionId };
  } catch (coreErr) {
    // Withdraw the pushed row before anything else: the local approval is about
    // to be undone, and a `testable=true` Core question with no QM link is
    // exactly the orphan AI Tutor would keep serving.
    let compensationFailed = false;
    if (pushedCoreQuestionId) {
      const compensation = await withdrawVariantFromCore(pushedCoreQuestionId);
      compensationFailed = compensation.outcome === "failed";
    }

    // Roll approval back to draft before reporting an error. The approval is
    // already persisted; leaving it approved would trip VARIANT_LOCKED on the
    // next attempt and block the retry this promises.
    let rollbackFailed = false;
    try {
      const rollbackResult = await rollbackVariantApproval(variant.id, ownerId, variant);
      // A concurrent retry may have moved the row to another state; only a
      // demonstrably draft row makes the error response truthful.
      if (rollbackResult?.variant?.isDraft !== true) rollbackFailed = true;
    } catch (rollbackErr) {
      rollbackFailed = true;
      logger.error(
        { err: rollbackErr, variantId: variant.id },
        "Failed to roll variant back after Core push failure",
      );
    }

    if (rollbackFailed) return { outcome: "rollback-failed" };
    if (compensationFailed) {
      return { outcome: "orphaned-core-question", coreQuestionId: pushedCoreQuestionId };
    }

    if (coreErr.status === 422) {
      const errBody = coreErr.body ?? {};
      if (
        errBody.error === "INVALID_TOPIC_IDS" &&
        Array.isArray(errBody.deletedTopicIds) &&
        errBody.deletedTopicIds.length > 0
      ) {
        await prisma.topics.updateMany({
          where: { coreTopicId: { in: errBody.deletedTopicIds } },
          data: { coreTopicId: null },
        });
        return { outcome: "invalid-topics", deletedTopicIds: errBody.deletedTopicIds };
      }
      if (errBody.error === "DUPLICATE_TOPIC") return { outcome: "duplicate-topic" };
    }

    // #225 SEAM-03 / #1197: any other push failure (Core down, 5xx, network
    // error) must not report success — a 200 would let the UI show a question
    // as published when it isn't.
    logger.warn({ err: coreErr }, "Core question push failed; rolled variant back to draft");
    return { outcome: "push-failed" };
  }
}

/**
 * Writes the failure response for a publish result. Returns false when the
 * result is not a failure, so the caller carries on with its success response.
 */
export function respondToPublishFailure(res, result) {
  switch (result.outcome) {
    case "conflict":
      res.status(409).json({
        success: false,
        code: "VARIANT_LOCKED",
        error: "Someone else changed this question at the same time. Reload and try again.",
      });
      return true;
    case "rollback-failed":
      res.status(500).json({
        success: false,
        code: "VARIANT_ROLLBACK_FAILED",
        error:
          "Publishing to EduAI failed and this question was left in an unclear state. Reload before trying again.",
      });
      return true;
    case "invalid-topics":
      res.status(422).json({
        success: false,
        code: "INVALID_TOPIC_IDS",
        error:
          "Some topics have been deleted in EduAI. Update this question's topics and mark it reviewed again.",
        deletedTopicIds: result.deletedTopicIds,
      });
      return true;
    case "duplicate-topic":
      res.status(422).json({
        success: false,
        code: "DUPLICATE_TOPIC",
        error:
          "The primary topic also appears in the secondary topics. Fix the topic list and mark it reviewed again.",
      });
      return true;
    case "orphaned-core-question":
      res.status(502).json({
        success: false,
        code: "CORE_PUBLISH_COMPENSATION_FAILED",
        error:
          "This question reached EduAI but could not be linked back or withdrawn there. Reload before trying again.",
      });
      return true;
    case "push-failed":
      res.status(502).json({
        success: false,
        code: "CORE_PUSH_FAILED",
        error: "Could not publish this question to EduAI. It stays a draft — please retry.",
      });
      return true;
    default:
      return false;
  }
}

/**
 * Withdraws a published Core question before its local variant is un-reviewed.
 *
 * Clearing `coreQuestionId` locally only forgets the link — the Core question
 * keeps whatever `testable` it was pushed with, so AI Tutor would go on
 * serving an un-reviewed question from the `testable=true` bank, and the next
 * approval would mint a second Core row beside it (#1652 review). Disabling it
 * first makes the withdrawal visible everywhere the question can be read.
 *
 * Idempotent: a Core question that no longer exists (404 → null) is already
 * withdrawn, and re-approval re-asserts the author's current share choice.
 *
 * @returns {Promise<{ outcome: "withdrawn" | "gone" | "failed" }>}
 */
export async function withdrawVariantFromCore(coreQuestionId) {
  try {
    const result = await patchQuestionTestableOnCore(coreQuestionId, false);
    return { outcome: result === null ? "gone" : "withdrawn" };
  } catch (err) {
    logger.warn({ err, coreQuestionId }, "Failed to withdraw Core question before un-review");
    return { outcome: "failed" };
  }
}
