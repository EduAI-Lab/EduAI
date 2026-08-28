/**
 * Router for managing question variants (create/read/update/delete).
 *
 * RBAC (rbac-matrix.md §16 + §19, issues #311/#312):
 *  - Per-course access gate (requireQuestionAccess / requireVariantAccess) admits
 *    ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) / TA(C) and pins `req.qmCourse`.
 *    Core identifies a course TA as platform STUDENT, so these course-scoped
 *    routes must not apply a flat platform-role gate before enrollment lookup.
 *  - Resource semantics (#312): TA own-only edit/delete, instructor-only approval
 *    (isDraft:false), and the approved-variant 409 lock.
 * Course scoping in the service layer keys off the authorized course's owner id
 * (`req.qmCourse.userId`); authorization itself is the middleware's job.
 *
 * #1080/#1072 §4 step 9: reviewed questions are immutable. The 409 lock below covers
 * questionText/difficulty/secondaryTopicsId (variant fields); `type` + `primaryTopicId`
 * live on Question_Metadata and are locked the same way in `questionService.updateQuestion`
 * (same 409 VARIANT_LOCKED convention) whenever any sibling variant is still reviewed.
 * Un-reviewing (isDraft:true) clears `coreQuestionId` in `updateVariant` so the next
 * approval re-pushes instead of the state-based push guard below treating it as linked.
 */
import express from "express";
import {
  createVariant,
  updateVariant,
  deleteVariant,
  getVariantsByQuestion,
  applyVariantShareChoice,
  clearVariantCoreLinkIfUnchanged,
} from "../services/questionService.js";
import { patchQuestionTestableOnCore } from "../services/coreApiService.js";
import { VALID_DIFFICULTIES, VALID_REASONING_LEVELS } from "../services/coreWiringService.js";
import {
  publishApprovedVariant,
  respondToPublishFailure,
  withdrawVariantFromCore,
} from "../services/variant-publish.js";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { QM_AUTHORIZED } from "../middleware/roles.js";
import { requireQuestionAccess, requireVariantAccess } from "../middleware/resourceAccess.js";
import { LEVELS } from "../middleware/courseAccess.js";
import { parsePaginationParams, pageOf } from "../utils/pagination.js";

const router = express.Router();

/** Coerce a raw isDraft value to a strict boolean, or undefined when absent. */
function parseIsDraft(raw) {
  if (raw === true || raw === "true") return true;
  if (raw === false || raw === "false") return false;
  return undefined;
}

/**
 * Validate difficulty/reasoningLevel against their allowed enum values before
 * persisting or pushing (#6). Returns an error string when a *provided* value is
 * invalid, or null when both are absent/valid (defaults are applied downstream).
 */
function validateVariantEnums({ difficulty, reasoningLevel }) {
  if (difficulty !== undefined && difficulty !== null && !VALID_DIFFICULTIES.includes(difficulty)) {
    return `Invalid difficulty. Allowed values: ${VALID_DIFFICULTIES.join(", ")}`;
  }
  if (
    reasoningLevel !== undefined &&
    reasoningLevel !== null &&
    !VALID_REASONING_LEVELS.includes(reasoningLevel)
  ) {
    return `Invalid reasoningLevel. Allowed values: ${VALID_REASONING_LEVELS.join(", ")}`;
  }
  return null;
}

/** POST /api/questions/:id/variants – creates a variant under the given question after validation. */
router.post(
  "/:id/variants",
  authenticateToken,
  requireQuestionAccess({ min: "ta" }),
  async (req, res, next) => {
    try {
      const {
        questionText,
        difficulty,
        reasoningLevel,
        assessmentId,
        secondaryTopicsId,
        answer,
        choices,
        selectAllThatApply,
        correctAnswers,
        referenceId,
        isAiGenerated,
        isDraft,
        shareWithExtensions,
      } = req.body;

      if (!questionText || !questionText.trim()) {
        return res.status(400).json({
          success: false,
          error: "Question text is required",
        });
      }

      const enumError = validateVariantEnums({ difficulty, reasoningLevel });
      if (enumError) {
        return res.status(400).json({ success: false, error: enumError });
      }

      const variant = await createVariant(
        req.params.id,
        {
          questionText: questionText.trim(),
          difficulty,
          reasoningLevel,
          assessmentId,
          secondaryTopicsId,
          answer,
          choices,
          selectAllThatApply,
          correctAnswers,
          referenceId,
          isAiGenerated,
          isDraft,
          shareWithExtensions,
          createdBy: req.user.id,
        },
        req.qmCourse.userId,
      );

      // A variant created already reviewed has to reach Core here: approved
      // with no coreQuestionId is `approvalInFlight`, a state that can never be
      // reverted, so skipping the push would strand it permanently.
      if (variant?.isDraft === false) {
        const publishResult = await publishApprovedVariant({
          variant,
          ownerId: req.qmCourse.userId,
          cookie: req.headers.cookie,
        });
        if (respondToPublishFailure(res, publishResult)) return;
        if (publishResult.outcome === "linked") {
          variant.coreQuestionId = publishResult.coreQuestionId;
        }
      }

      res.status(201).json({
        success: true,
        message: "Variant created successfully",
        data: variant,
      });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /api/questions/:id/variants – returns all variants for a question the caller can access. */
router.get(
  "/:id/variants",
  authenticateToken,
  requireQuestionAccess({ min: "ta" }),
  async (req, res, next) => {
    try {
      // Structure-bounded (#1044): always a bounded page — params are optional,
      // so a caller that sends none gets the first page rather than a 400, but
      // never the unbounded set. Sliced in memory (`total` = the question's
      // full variant count) to stay uniform with the other structure-bounded
      // lists in this app.
      const pagination = parsePaginationParams(req, { required: false, defaultPageSize: 200 });
      const all = await getVariantsByQuestion(req.params.id, req.qmCourse.userId);

      res.json(pageOf(all, pagination));
    } catch (error) {
      next(error);
    }
  },
);

/** PUT /api/questions/variants/:variantId – updates variant content. Enforces #312 semantics; triggers Core push on approval. */
router.put(
  "/variants/:variantId",
  authenticateToken,
  requireVariantAccess({ min: "ta" }),
  async (req, res, next) => {
    try {
      const {
        questionText,
        difficulty,
        reasoningLevel,
        assessmentId,
        secondaryTopicsId,
        answer,
        choices,
        selectAllThatApply,
        correctAnswers,
        referenceId,
        isAiGenerated,
        isDraft: isDraftRaw,
        shareWithExtensions,
      } = req.body;
      const isDraft = parseIsDraft(isDraftRaw);

      const enumError = validateVariantEnums({ difficulty, reasoningLevel });
      if (enumError) {
        return res.status(400).json({ success: false, error: enumError });
      }

      const access = req.courseAccess;
      const isInstructorPlus = access.rank >= LEVELS.instructor.rank;
      const current = req.variant;

      // Keep the inexpensive resource-snapshot checks for immediate RBAC
      // responses. `updateVariant` repeats the same decisions after acquiring
      // the question fence; these checks must never be treated as the
      // authoritative immutability guard because `req.variant` can be stale.
      if (current.isDraft === false) {
        const reverting = isDraft === true && isInstructorPlus;
        const approvalRetry =
          isDraft === false &&
          isInstructorPlus &&
          current.coreQuestionId == null &&
          req.qmCourse.coreCourseId &&
          isAiGenerated === undefined &&
          questionText === undefined &&
          difficulty === undefined &&
          reasoningLevel === undefined &&
          assessmentId === undefined &&
          secondaryTopicsId === undefined &&
          answer === undefined &&
          choices === undefined &&
          referenceId === undefined;
        const aiTagOnly =
          isAiGenerated !== undefined &&
          isDraftRaw === undefined &&
          questionText === undefined &&
          difficulty === undefined &&
          reasoningLevel === undefined &&
          assessmentId === undefined &&
          secondaryTopicsId === undefined &&
          answer === undefined &&
          choices === undefined &&
          selectAllThatApply === undefined &&
          correctAnswers === undefined &&
          referenceId === undefined;
        if (!reverting && !aiTagOnly && !approvalRetry) {
          return res.status(409).json({
            success: false,
            code: "VARIANT_LOCKED",
            error:
              "This question is reviewed, so its content is locked. Move it back to draft to reopen it for editing.",
          });
        }
        // §19 TA own-only edit applies here too: the aiTagOnly path is still an edit.
        if (aiTagOnly && access.level === "ta" && current.createdBy !== req.user.id) {
          return res
            .status(403)
            .json({ success: false, error: "TAs can only edit their own variants" });
        }
      } else {
        if (isDraft === false && !isInstructorPlus) {
          return res
            .status(403)
            .json({ success: false, error: "Only instructors can approve variants" });
        }
        if (access.level === "ta" && current.createdBy !== req.user.id) {
          return res
            .status(403)
            .json({ success: false, error: "TAs can only edit their own variants" });
        }
      }

      // Un-reviewing a published variant withdraws its Core question first.
      // `updateVariant` drops `coreQuestionId` inside the fence, so once that
      // has run there is nothing left to point at the Core row — and a Core
      // question left `testable` would keep being served to other extensions
      // for a question that is no longer reviewed (#1652 review). Disabling it
      // is idempotent, so a stale snapshot at worst repeats a withdrawal that
      // already happened.
      let withdrawnCoreQuestionId = null;
      if (isDraft === true && current.isDraft === false && current.coreQuestionId) {
        const withdrawal = await withdrawVariantFromCore(current.coreQuestionId);
        if (withdrawal.outcome === "failed") {
          return res.status(502).json({
            success: false,
            code: "CORE_WITHDRAW_FAILED",
            error:
              "Could not withdraw this question from EduAI, so it was left reviewed. Please retry.",
          });
        }
        withdrawnCoreQuestionId = current.coreQuestionId;
      }

      const variant = await updateVariant(
        req.params.variantId,
        {
          questionText,
          difficulty,
          reasoningLevel,
          assessmentId,
          secondaryTopicsId,
          answer,
          choices,
          selectAllThatApply,
          correctAnswers,
          referenceId,
          isAiGenerated,
          isDraft,
          shareWithExtensions,
        },
        req.qmCourse.userId,
        {
          isInstructorPlus,
          accessLevel: access.level,
          requestUserId: req.user.id,
          // Lets the fence reject an un-review whose withdrawal was decided
          // against a link that is no longer the current one (#1652 review).
          withdrawnCoreQuestionId,
        },
      );

      // State-based push: fires whenever the caller sets isDraft=false and the
      // variant is not yet linked to Core. The stable idempotencyKey makes
      // repeated calls to Core safe. Shared with the create route so an
      // already-reviewed new variant publishes the same way.
      if (isDraft === false) {
        const publishResult = await publishApprovedVariant({
          variant,
          ownerId: req.qmCourse.userId,
          cookie: req.headers.cookie,
        });
        if (respondToPublishFailure(res, publishResult)) return;
        if (publishResult.outcome === "linked") {
          // Prisma's update() returns a new object rather than mutating
          // `variant` in place, so patch it locally for the response below.
          variant.coreQuestionId = publishResult.coreQuestionId;
        }
      }

      res.json({
        success: true,
        message: "Variant updated successfully",
        data: variant,
      });
    } catch (error) {
      next(error);
    }
  },
);

/** PATCH /api/questions/variants/:variantId/testable – proxies testable toggle to Core; nulls coreQuestionId on 404. */
router.patch(
  "/variants/:variantId/testable",
  authenticateToken,
  requireRole(QM_AUTHORIZED),
  requireVariantAccess({ min: "instructor" }),
  async (req, res, next) => {
    try {
      const { testable } = req.body;

      if (typeof testable !== "boolean") {
        return res.status(400).json({ success: false, error: "testable must be a boolean" });
      }

      const variant = req.variant;

      if (!variant.coreQuestionId) {
        return res
          .status(400)
          .json({ success: false, error: "Variant has not been pushed to Core yet" });
      }

      // `req.variant` is a pre-fence snapshot, so everything below is written
      // conditionally: Core is patched first, then the local row is updated
      // only while it is still the approved variant linked to the question that
      // was patched. A concurrent un-review otherwise leaves a draft flagged as
      // shared, or re-enables a Core question that was just withdrawn (#1652
      // review).
      const result = await patchQuestionTestableOnCore(variant.coreQuestionId, testable);

      if (result === null) {
        await clearVariantCoreLinkIfUnchanged(
          variant.id,
          req.qmCourse.userId,
          variant.coreQuestionId,
        );
        return res.status(404).json({ success: false, error: "QUESTION_NOT_FOUND" });
      }

      // Record the same choice locally (#1555): the authoring checkbox reads
      // this column, so leaving it behind would show a stale answer to the very
      // next person who opens the question.
      const applied = await applyVariantShareChoice(
        variant.id,
        req.qmCourse.userId,
        variant.coreQuestionId,
        testable,
      );

      if (!applied.applied) {
        // The row moved on under us. Undo the Core write so the question is not
        // left shared on the strength of a choice that was never persisted; a
        // concurrent un-review's own withdrawal makes this a no-op.
        if (testable) {
          const compensation = await withdrawVariantFromCore(variant.coreQuestionId);
          if (compensation.outcome === "failed") {
            return res.status(502).json({
              success: false,
              code: "CORE_SHARE_COMPENSATION_FAILED",
              error:
                "This question changed while your sharing choice was in flight, and EduAI could not be reverted. Please retry.",
            });
          }
        }
        return res.status(409).json({
          success: false,
          code: "VARIANT_STATE_CHANGED",
          error:
            "This question changed while your sharing choice was in flight, so it was not applied. Please reopen it and try again.",
        });
      }

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

/** DELETE /api/questions/variants/:variantId – removes a variant; TAs may delete only their own. */
router.delete(
  "/variants/:variantId",
  authenticateToken,
  requireVariantAccess({ min: "ta" }),
  async (req, res, next) => {
    try {
      // §19 TA own-only delete (null createdBy = no owner → TA denied).
      if (req.courseAccess.level === "ta" && req.variant.createdBy !== req.user.id) {
        return res
          .status(403)
          .json({ success: false, error: "TAs can only delete their own variants" });
      }

      await deleteVariant(req.params.variantId, req.qmCourse.userId);

      res.json({
        success: true,
        message: "Variant deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
