/**
 * Orchestration helpers that bridge QM's local data model and Core API calls.
 * Handles topic resolution (push-if-missing) before pushing a variant as a Core Question.
 */
import crypto from 'node:crypto';
import { prisma } from '../config/database.js';
import { pushTopicToCore, pushQuestionToCore, patchQuestionTestableOnCore } from './coreApiService.js';

/** Allowed enum values, validated before persisting/pushing (mirrors the Variants model + questionService). */
export const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'];
export const VALID_REASONING_LEVELS = ['factual', 'analytical', 'application'];

/**
 * Content fields hashed into the idempotency key (#1080 follow-up). Explicit
 * order — do not rely on object-key iteration order. Volatile fields (e.g.
 * timestamps) must never be added here: they'd make the key change on every
 * call and defeat retry-safety.
 */
const IDEMPOTENCY_HASH_FIELDS = [
  'courseId',
  'topicId',
  'content',
  'type',
  'difficulty',
  'reasoningLevel',
  'choices',
  'answer',
  'selectAllThatApply',
  'correctAnswers',
  'testable',
  'secondaryTopicIds',
];

/** Deterministic stringify: object keys are sorted so field order in source never matters. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Short content hash (12 hex chars) over the fields in IDEMPOTENCY_HASH_FIELDS,
 * serialized with an explicit stable field order. Identical content -> identical
 * hash (retry safety); any content change -> a different hash (so a re-approve
 * after an edit pushes a fresh Core row instead of replaying the stale one).
 */
function hashPayloadContent(payload) {
  const canonical = IDEMPOTENCY_HASH_FIELDS.map((field) => stableStringify(payload[field] ?? null)).join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

/**
 * Ensures a local topic has a coreTopicId, pushing it to Core first if needed.
 * Returns the Core topic ID.
 */
async function resolveCoreTopicId(topic, coreCourseId) {
  if (topic.coreTopicId) return topic.coreTopicId;
  const result = await pushTopicToCore(coreCourseId, topic.name);
  await prisma.topics.update({ where: { id: topic.id }, data: { coreTopicId: result.id } });
  return result.id;
}

/**
 * Translates a variant's local topic IDs to Core topic IDs, pushing any missing ones,
 * then POSTs the variant to Core as a Question.
 *
 * @param {object} variant  - Variants row (with questionMetadata loaded)
 * @param {object} course   - Course row (must have coreCourseId)
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

  const primaryTopic = await prisma.topics.findUnique({ where: { id: qm.primaryTopicId } });
  if (!primaryTopic) throw new Error('Primary topic not found locally');

  const primaryCoreTopicId = await resolveCoreTopicId(primaryTopic, course.coreCourseId);

  // Resolve secondary topics concurrently while preserving the order of
  // `secondaryTopicsId` (#1 N+1 fix). Look up by id keyed map so a missing local
  // topic is skipped rather than silently shifting the order.
  const secondaryLocalIds = variant.secondaryTopicsId ?? [];
  let coreSecondaryTopicIds = [];
  if (secondaryLocalIds.length > 0) {
    const secondaryTopics = await prisma.topics.findMany({ where: { id: { in: secondaryLocalIds } } });
    const byId = new Map(secondaryTopics.map((t) => [t.id, t]));
    const ordered = secondaryLocalIds.map((id) => byId.get(id)).filter(Boolean);
    coreSecondaryTopicIds = await Promise.all(
      ordered.map((t) => resolveCoreTopicId(t, course.coreCourseId)),
    );
  }

  const payload = {
    courseId: course.coreCourseId,
    topicId: primaryCoreTopicId,
    content: variant.questionText,
    type: qm.type,
    difficulty: difficulty.toUpperCase(),
    reasoningLevel: reasoningLevel.toUpperCase(),
    choices: variant.choices ?? undefined,
    answer: variant.answer ?? undefined,
    selectAllThatApply: variant.selectAllThatApply ?? false,
    correctAnswers: variant.correctAnswers ?? undefined,
    testable: false,
    secondaryTopicIds: coreSecondaryTopicIds,
  };
  payload.idempotencyKey = `qm-variant-${variant.id}-${hashPayloadContent(payload)}`;

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
