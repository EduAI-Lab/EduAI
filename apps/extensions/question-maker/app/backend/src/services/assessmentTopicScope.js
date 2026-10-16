/**
 * Assessment topic scope (#1974). An assessment may be limited to a set of
 * course topics, stored as `blueprintConfig.primaryTopicIds`; an empty or
 * missing list means every topic is allowed. A question belongs to the scope
 * through its primary topic only.
 */
import { prisma } from "../config/database.js";

function publicError(status, code, message, extra = {}) {
  return Object.assign(new Error(message), {
    status,
    statusCode: status,
    code,
    isPublic: true,
    ...extra,
  });
}

/** The chosen topic ids as a Set, or null when the assessment is unrestricted. */
export function assessmentTopicScope(assessment) {
  const raw = assessment?.blueprintConfig?.primaryTopicIds;
  if (!Array.isArray(raw)) return null;
  const ids = raw.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim());
  return ids.length > 0 ? new Set(ids) : null;
}

/** Reject a client-supplied blueprintConfig that is not a plain object (#1974). */
export function assertBlueprintConfigIsObject(value) {
  if (value === undefined || value === null) return;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw publicError(400, "QM_ASSESSMENT_BLUEPRINT_INVALID", "blueprintConfig must be an object");
  }
}

/** A stored blueprintConfig as a mergeable object; anything non-object counts as empty. */
export function storedBlueprintObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** Validate and normalize a client-supplied topic id list. */
export function normalizeTopicIdList(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
    throw publicError(
      400,
      "QM_ASSESSMENT_TOPICS_INVALID",
      "primaryTopicIds must be an array of topic ids",
    );
  }
  return [...new Set(value.map((id) => id.trim()).filter(Boolean))];
}

/** Ensure every chosen topic is a topic of the assessment's course. */
export async function assertAssessmentTopicsInCourse(topicIds, courseId, db = prisma) {
  if (topicIds.length === 0) return;
  const rows = await db.topics.findMany({
    where: { id: { in: topicIds }, courseId },
    select: { id: true },
  });
  if (rows.length !== topicIds.length) {
    throw publicError(
      400,
      "QM_ASSESSMENT_TOPICS_INVALID",
      "Assessment topic not found for this course",
    );
  }
}

/** Reject a question whose primary topic is outside a limited assessment. */
export function assertQuestionInAssessmentTopics(assessment, primaryTopicId) {
  const scope = assessmentTopicScope(assessment);
  if (scope && !scope.has(primaryTopicId)) {
    throw publicError(
      400,
      "QM_VARIANT_OUTSIDE_ASSESSMENT_TOPICS",
      "This question's topic is not one of the topics this assessment covers",
    );
  }
}

/** Questions already in the assessment whose primary topic is outside `topicIds`. */
export async function findOffTopicAssessmentQuestions(assessmentId, topicIds, db = prisma) {
  return db.questionMetadata.findMany({
    where: {
      primaryTopicId: { notIn: topicIds },
      variants: {
        some: {
          OR: [{ assessmentId }, { sectionLinks: { some: { section: { assessmentId } } } }],
        },
      },
    },
    select: { id: true, description: true },
    orderBy: { id: "asc" },
  });
}

/** A 409 naming the questions that block a topic change. */
export function topicConflictError(message, questions) {
  return publicError(409, "QM_ASSESSMENT_TOPIC_CONFLICT", message, { details: { questions } });
}
