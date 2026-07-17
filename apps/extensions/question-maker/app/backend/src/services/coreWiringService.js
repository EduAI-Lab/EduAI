/**
 * Orchestration helpers that bridge QM's local data model and Core API calls.
 * Handles topic resolution (push-if-missing) before pushing a variant as a Core Question.
 */
import { Topics, CanvasBankQuestionMapping } from '../schema/index.js';
import { pushTopicToCore, pushQuestionToCore, patchQuestionTestableOnCore } from './coreApiService.js';

/** Allowed enum values, validated before persisting/pushing (mirrors the Variants model + questionService). */
export const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'];
export const VALID_REASONING_LEVELS = ['factual', 'analytical', 'application'];

/**
 * Ensures a local topic has a coreTopicId, pushing it to Core first if needed.
 * Returns the Core topic ID.
 */
async function resolveCoreTopicId(topic, coreCourseId) {
  if (topic.coreTopicId) return topic.coreTopicId;
  const result = await pushTopicToCore(coreCourseId, topic.name);
  await topic.update({ coreTopicId: result.id });
  return result.id;
}

/**
 * Translates a variant's local topic IDs to Core topic IDs, pushing any missing ones,
 * then POSTs the variant to Core as a Question.
 *
 * @param {object} variant  - Sequelize Variants instance (with questionMetadata loaded)
 * @param {object} course   - Sequelize Course instance (must have coreCourseId)
 * @param {string} cookieHeader - req.headers.cookie to forward for Core session auth
 * @returns {{ coreQuestionId: string }}
 * @throws  Error with .status + .body on Core API errors (422, 4xx, 5xx)
 */
export async function pushVariantToCore(variant, course, cookieHeader) {
  const qm = variant.questionMetadata;

  // Validate enums up front so an invalid value fails loudly instead of being
  // silently normalized into a Core question (#6).
  const difficulty = (variant.difficulty || 'medium').toLowerCase();
  if (!VALID_DIFFICULTIES.includes(difficulty)) {
    throw Object.assign(new Error(`Invalid difficulty: ${variant.difficulty}`), { status: 400 });
  }
  const reasoningLevel = (variant.reasoningLevel || 'factual').toLowerCase();
  if (!VALID_REASONING_LEVELS.includes(reasoningLevel)) {
    throw Object.assign(new Error(`Invalid reasoningLevel: ${variant.reasoningLevel}`), { status: 400 });
  }

  const primaryTopic = await Topics.findOne({ where: { id: qm.primaryTopicId } });
  if (!primaryTopic) throw new Error('Primary topic not found locally');

  const primaryCoreTopicId = await resolveCoreTopicId(primaryTopic, course.coreCourseId);

  // Resolve secondary topics concurrently while preserving the order of
  // `secondaryTopicsId` (#1 N+1 fix). Look up by id keyed map so a missing local
  // topic is skipped rather than silently shifting the order.
  const secondaryLocalIds = variant.secondaryTopicsId ?? [];
  let coreSecondaryTopicIds = [];
  if (secondaryLocalIds.length > 0) {
    const secondaryTopics = await Topics.findAll({ where: { id: secondaryLocalIds } });
    const byId = new Map(secondaryTopics.map((t) => [t.id, t]));
    const ordered = secondaryLocalIds.map((id) => byId.get(id)).filter(Boolean);
    coreSecondaryTopicIds = await Promise.all(
      ordered.map((t) => resolveCoreTopicId(t, course.coreCourseId)),
    );
  }

  const canvasMap = await CanvasBankQuestionMapping.findOne({
    where: { localQuestionMetadataId: qm.id },
  });

  const payload = {
    courseId: course.coreCourseId,
    topicId: primaryCoreTopicId,
    content: variant.questionText,
    type: qm.type,
    difficulty: difficulty.toUpperCase(),
    reasoningLevel: reasoningLevel.toUpperCase(),
    choices: variant.choices ?? undefined,
    answer: variant.answer ?? undefined,
    testable: false,
    secondaryTopicIds: coreSecondaryTopicIds,
    idempotencyKey: `qm-variant-${variant.id}`,
    source: 'question-maker',
    ...(canvasMap
      ? {
          externalSource: 'CANVAS',
          externalId: String(canvasMap.canvasAssessmentQuestionId),
        }
      : {}),
  };

  // Idempotency (#2): if this variant already links to a Core question, do not
  // create a duplicate. Confirm the Core row still exists (PATCH returns null on
  // 404); if it was deleted on Core, fall through to recreate so a partial-failure
  // retry can re-link instead of orphaning.
  if (variant.coreQuestionId) {
    const existing = await patchQuestionTestableOnCore(variant.coreQuestionId, false);
    if (existing !== null) {
      return { coreQuestionId: variant.coreQuestionId };
    }
  }

  const result = await pushQuestionToCore(payload, cookieHeader);
  return { coreQuestionId: result.id };
}
