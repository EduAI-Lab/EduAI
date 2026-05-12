/**
 * Assessment variant workflow: mark reference exams, snapshot blueprints, and assemble equivalent variant exams.
 */
import { sequelize } from '../config/database.js';
import {
  Assessments,
  AssessmentSections,
  SectionVariants,
  Variants,
  Question_Metadata,
  Course,
  Topics,
  VariantSelectionCursor
} from '../schema/index.js';
import eduaiService from './eduaiService.js';
import { Op } from 'sequelize';
import { loadOrderedVariantsForAssessment, aggregateStructure } from './assessmentVariantUtils.js';
import { scoreMetadataMatch } from './assessmentVariantMetadataScoring.js';

const VALID_STUDY_ROLES = ['reference_baseline', 'generated_variant'];

/** Non-draft variant count per base question required before parallel assembly can swap alternate wording. */
export const MIN_NON_DRAFT_VARIANTS_FOR_WORKFLOW = 2;

/**
 * Per base question on a baseline assessment: non-draft variant counts in the bank and readiness for assembly.
 */
export async function getBaselineVariantReadiness(userId, { assessmentId, courseId }) {
  if (!assessmentId || !courseId) {
    throw new Error('assessmentId and courseId are required');
  }

  const assessment = await Assessments.findOne({
    where: { id: Number(assessmentId), courseId: Number(courseId) },
    include: [
      {
        model: Course,
        as: 'course',
        where: { userId },
        attributes: ['id'],
        required: true
      }
    ]
  });

  if (!assessment) {
    throw new Error('Assessment not found or course mismatch');
  }

  const orderedVariants = await loadOrderedVariantsForAssessment(assessment.id);
  const seenMeta = new Set();
  const slots = [];

  for (const v of orderedVariants) {
    const mid = v.questionMetadata?.id;
    if (mid == null || seenMeta.has(mid)) continue;
    seenMeta.add(mid);

    const metaRow = await Question_Metadata.findOne({
      where: { id: mid, courseId: Number(courseId) },
      attributes: ['id']
    });
    if (!metaRow) continue;

    const nonDraftVariantCount = await Variants.count({
      where: { questionMetadataId: mid, isDraft: false }
    });

    slots.push({
      order: slots.length + 1,
      questionMetadataId: mid,
      description: v.questionMetadata?.description ?? null,
      questionType: v.questionMetadata?.type ?? null,
      nonDraftVariantCount,
      ready: nonDraftVariantCount >= MIN_NON_DRAFT_VARIANTS_FOR_WORKFLOW
    });
  }

  return {
    assessmentId: assessment.id,
    courseId: assessment.courseId,
    minRequiredNonDraft: MIN_NON_DRAFT_VARIANTS_FOR_WORKFLOW,
    slots,
    allReady: slots.length > 0 && slots.every((s) => s.ready)
  };
}

/** Merges `studyRole` into assessment.blueprintConfig (JSONB). */
export async function setAssessmentStudyRole(assessmentId, userId, studyRole) {
  if (studyRole !== null && studyRole !== undefined && !VALID_STUDY_ROLES.includes(studyRole)) {
    throw new Error('Invalid studyRole');
  }

  const assessment = await Assessments.findOne({
    where: { id: assessmentId },
    include: [
      {
        model: Course,
        as: 'course',
        where: { userId },
        attributes: ['id'],
        required: true
      }
    ]
  });

  if (!assessment) {
    throw new Error('Assessment not found');
  }

  const prev = assessment.blueprintConfig || {};
  const next = { ...prev };
  if (studyRole === null || studyRole === undefined) {
    delete next.studyRole;
  } else {
    next.studyRole = studyRole;
  }

  await assessment.update({ blueprintConfig: Object.keys(next).length ? next : null });
  return assessment;
}

/**
 * Ordered slots from a reference assessment: one entry per placed variant.
 */
export async function getBlueprintSnapshot(assessmentId, userId) {
  const assessment = await Assessments.findOne({
    where: { id: assessmentId },
    include: [
      {
        model: Course,
        as: 'course',
        where: { userId },
        attributes: ['id', 'name', 'code'],
        required: true
      }
    ]
  });

  if (!assessment) {
    throw new Error('Assessment not found');
  }

  const variants = await loadOrderedVariantsForAssessment(assessmentId);
  const slots = variants.map((v, index) => ({
    order: index + 1,
    variantId: v.id,
    questionMetadataId: v.questionMetadata?.id ?? null,
    questionType: v.questionMetadata?.type ?? null,
    primaryTopicId: v.questionMetadata?.primaryTopicId ?? null,
    difficulty: v.difficulty,
    reasoningLevel: v.reasoningLevel
  }));

  const structure = aggregateStructure(variants);

  return {
    assessmentId: assessment.id,
    courseId: assessment.courseId,
    name: assessment.name,
    semester: assessment.semester,
    type: assessment.type,
    studyRole: assessment.blueprintConfig?.studyRole ?? null,
    slotCount: slots.length,
    slots,
    aggregates: {
      topicCounts: structure.topicCounts,
      difficultyCounts: structure.difficultyCounts,
      typeCounts: structure.typeCounts,
      baseQuestionIds: structure.baseQuestionIds
    }
  };
}

/**
 * Picks a variant id for `questionMetadataId`, avoiding ids in `excludeIds`, preferring not `avoidVariantId`.
 */
async function getSelectionCursorForUpdate({ questionMetadataId, courseId, transaction }) {
  let cursor = await VariantSelectionCursor.findOne({
    where: { questionMetadataId, courseId },
    transaction,
    lock: transaction.LOCK.UPDATE
  });
  if (cursor) {
    return cursor;
  }

  try {
    cursor = await VariantSelectionCursor.create(
      {
        questionMetadataId,
        courseId,
        nextOffset: 0,
        lastVariantId: null
      },
      { transaction }
    );
    return cursor;
  } catch (error) {
    // Another transaction may create this row first due to unique key race.
    cursor = await VariantSelectionCursor.findOne({
      where: { questionMetadataId, courseId },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (cursor) {
      return cursor;
    }
    throw error;
  }
}

async function pickVariantForSlot({
  questionMetadataId,
  courseId,
  excludeIds,
  avoidVariantId,
  includeDrafts,
  transaction
}) {
  const where = {
    questionMetadataId
  };
  if (!includeDrafts) {
    where.isDraft = false;
  }

  if (excludeIds.length > 0) {
    where.id = { [Op.notIn]: excludeIds };
  }

  const candidates = await Variants.findAll({
    where,
    include: [
      {
        model: Question_Metadata,
        as: 'questionMetadata',
        where: { courseId },
        attributes: ['id'],
        required: true
      }
    ],
    order: [['id', 'ASC']],
    transaction
  });

  if (candidates.length === 0) {
    return null;
  }

  const preferred = candidates.filter((c) => c.id !== avoidVariantId);
  const pool = preferred.length > 0 ? preferred : candidates;
  const cursor = await getSelectionCursorForUpdate({ questionMetadataId, courseId, transaction });
  const offset = Number.isInteger(cursor.nextOffset) ? cursor.nextOffset : 0;
  const pickIndex = ((offset % pool.length) + pool.length) % pool.length;
  const picked = pool[pickIndex].id;

  await cursor.update(
    {
      nextOffset: offset + 1,
      lastVariantId: picked
    },
    { transaction }
  );

  return picked;
}

/**
 * Creates N parallel exams mirroring the reference order: same base question per slot, different variants when possible.
 */
export async function assembleEquivalentExamVariants(userId, params) {
  const {
    referenceAssessmentId,
    courseId,
    examLabels = ['Variant exam'],
    namePrefix = null,
    includeDrafts = false,
    semesterOverride = null,
    assessmentTypeOverride = null
  } = params;

  if (!referenceAssessmentId || !courseId) {
    throw new Error('referenceAssessmentId and courseId are required');
  }

  const ref = await Assessments.findOne({
    where: { id: referenceAssessmentId, courseId },
    include: [
      {
        model: Course,
        as: 'course',
        where: { userId },
        attributes: ['id'],
        required: true
      }
    ]
  });

  if (!ref) {
    throw new Error('Reference assessment not found or course mismatch');
  }

  const refVariants = await loadOrderedVariantsForAssessment(referenceAssessmentId);
  if (refVariants.length === 0) {
    throw new Error('Reference assessment has no questions in sections');
  }

  const slots = refVariants.map((v) => ({
    questionMetadataId: v.questionMetadata?.id,
    referenceVariantId: v.id
  }));

  if (slots.some((s) => !s.questionMetadataId)) {
    throw new Error('Every reference variant must have question metadata');
  }

  const started = Date.now();
  const warnings = [];
  const createdAssessments = [];

  const globalUsedVariantIds = new Set();

  await sequelize.transaction(async (t) => {
    for (let examIndex = 0; examIndex < examLabels.length; examIndex++) {
      const label = examLabels[examIndex];
      const baseName = namePrefix?.trim() || ref.name;
      const assessmentName = `${baseName} — ${label}`;

      const assessment = await Assessments.create(
        {
          courseId,
          type: assessmentTypeOverride || ref.type,
          name: assessmentName,
          semester: semesterOverride || ref.semester,
          description: `Assessment variant workflow exam (${label}) from reference assessment #${referenceAssessmentId}`,
          blueprintConfig: {
            studyRole: 'generated_variant',
            referenceAssessmentId: referenceAssessmentId,
            variantLabel: label,
            assembledAt: new Date().toISOString()
          }
        },
        { transaction: t }
      );

      const section = await AssessmentSections.create(
        {
          assessmentId: assessment.id,
          name: 'Exam',
          description: null,
          position: 0
        },
        { transaction: t }
      );

      const excludeForThisExam = new Set(globalUsedVariantIds);

      for (let i = 0; i < slots.length; i++) {
        const { questionMetadataId, referenceVariantId } = slots[i];
        const excludeIds = new Set(excludeForThisExam);
        const picked = await pickVariantForSlot({
          questionMetadataId,
          courseId,
          excludeIds: [...excludeIds],
          avoidVariantId: referenceVariantId,
          includeDrafts,
          transaction: t
        });

        if (picked == null) {
          throw new Error(
            `No variant available for question metadata ${questionMetadataId} at slot ${i + 1} (need more variants or allow drafts)`
          );
        }

        if (picked === referenceVariantId) {
          warnings.push({
            slot: i + 1,
            questionMetadataId,
            message: 'Reused reference variant text — add more variants for this base question'
          });
        }

        await SectionVariants.create(
          {
            sectionId: section.id,
            variantId: picked,
            displayOrder: i
          },
          { transaction: t }
        );

        await Variants.update(
          { assessmentId: assessment.id },
          { where: { id: picked }, transaction: t }
        );

        excludeForThisExam.add(picked);
        globalUsedVariantIds.add(picked);
      }

      createdAssessments.push(assessment);
    }
  });

  const assemblyTimeMs = Date.now() - started;

  return {
    referenceAssessmentId,
    courseId,
    createdAssessments: createdAssessments.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      semester: a.semester
    })),
    assemblyTimeMs,
    warnings,
    slotsProcessed: slots.length,
    examCount: examLabels.length
  };
}

const MIN_METADATA_SCORE = 75;

/**
 * Picks the best bank `question_metadata` row for a baseline slot (excluding already-used base ids).
 */
export async function findBestBankMetadataForSlot(slotVariant, courseId, usedBankMetadataIds) {
  const slotMeta = slotVariant.questionMetadata;
  if (!slotMeta) return null;

  const bankRows = await Question_Metadata.findAll({
    where: { courseId },
    include: [
      {
        model: Variants,
        as: 'variants',
        required: true,
        separate: true,
        order: [['id', 'ASC']]
      }
    ]
  });

  let best = null;
  let bestScore = -1;

  for (const bankMeta of bankRows) {
    if (usedBankMetadataIds.has(bankMeta.id)) continue;
    const rep =
      bankMeta.variants?.find((v) => !v.isDraft) || bankMeta.variants?.[0];
    if (!rep) continue;
    const score = scoreMetadataMatch(slotMeta, slotVariant, bankMeta, rep);
    if (score > bestScore) {
      bestScore = score;
      best = { bankMeta, score };
    }
  }

  if (!best || best.score < MIN_METADATA_SCORE) {
    return null;
  }
  return { questionMetadataId: best.bankMeta.id, score: best.score };
}

/**
 * Like `assembleEquivalentExamVariants`, but each slot uses the best bank question by metadata similarity
 * (topic, type, difficulty, reasoning), not necessarily the same `question_metadata` as the baseline row.
 */
export async function assembleExamVariantsByMetadataSimilarity(userId, params) {
  const {
    referenceAssessmentId,
    courseId,
    examLabels = ['Variant exam'],
    namePrefix = null,
    includeDrafts = true,
    semesterOverride = null,
    assessmentTypeOverride = null
  } = params;

  if (!referenceAssessmentId || !courseId) {
    throw new Error('referenceAssessmentId and courseId are required');
  }

  const ref = await Assessments.findOne({
    where: { id: referenceAssessmentId, courseId },
    include: [
      {
        model: Course,
        as: 'course',
        where: { userId },
        attributes: ['id'],
        required: true
      }
    ]
  });

  if (!ref) {
    throw new Error('Reference assessment not found or course mismatch');
  }

  const refVariants = await loadOrderedVariantsForAssessment(referenceAssessmentId);
  if (refVariants.length === 0) {
    throw new Error('Reference assessment has no questions in sections');
  }

  const started = Date.now();
  const warnings = [];
  const createdAssessments = [];
  const globalUsedVariantIds = new Set();
  const usedBankMetadataIds = new Set();

  await sequelize.transaction(async (t) => {
    for (let examIndex = 0; examIndex < examLabels.length; examIndex++) {
      const label = examLabels[examIndex];
      const baseName = namePrefix?.trim() || ref.name;
      const assessmentName = `${baseName} — ${label}`;

      const assessment = await Assessments.create(
        {
          courseId,
          type: assessmentTypeOverride || ref.type,
          name: assessmentName,
          semester: semesterOverride || ref.semester,
          description: `Assessment variant workflow exam (${label}) assembled by metadata similarity from reference #${referenceAssessmentId}`,
          blueprintConfig: {
            studyRole: 'generated_variant',
            referenceAssessmentId: referenceAssessmentId,
            variantLabel: label,
            assemblyMode: 'metadata_similarity',
            assembledAt: new Date().toISOString()
          }
        },
        { transaction: t }
      );

      const section = await AssessmentSections.create(
        {
          assessmentId: assessment.id,
          name: 'Exam',
          description: null,
          position: 0
        },
        { transaction: t }
      );

      const excludeForThisExam = new Set(globalUsedVariantIds);
      usedBankMetadataIds.clear();

      for (let i = 0; i < refVariants.length; i++) {
        const slotVariant = refVariants[i];
        const match = await findBestBankMetadataForSlot(slotVariant, courseId, usedBankMetadataIds);

        if (!match) {
          throw new Error(
            `No bank question met the metadata similarity threshold (>=${MIN_METADATA_SCORE}) for slot ${i + 1}. Add questions with matching topic/type in the bank.`
          );
        }

        usedBankMetadataIds.add(match.questionMetadataId);

        const excludeIds = new Set(excludeForThisExam);
        const picked = await pickVariantForSlot({
          questionMetadataId: match.questionMetadataId,
          courseId,
          excludeIds: [...excludeIds],
          avoidVariantId: slotVariant.id,
          includeDrafts,
          transaction: t
        });

        if (picked == null) {
          throw new Error(
            `No variant available for matched bank question ${match.questionMetadataId} at slot ${i + 1} (add more non-draft variants in the bank for that question, or enable drafts).`
          );
        }

        if (picked === slotVariant.id) {
          warnings.push({
            slot: i + 1,
            questionMetadataId: match.questionMetadataId,
            message: 'Reused baseline slot variant id — add more distinct variants in the bank.'
          });
        }

        await SectionVariants.create(
          {
            sectionId: section.id,
            variantId: picked,
            displayOrder: i
          },
          { transaction: t }
        );

        await Variants.update(
          { assessmentId: assessment.id },
          { where: { id: picked }, transaction: t }
        );

        excludeForThisExam.add(picked);
        globalUsedVariantIds.add(picked);
      }

      createdAssessments.push(assessment);
    }
  });

  const assemblyTimeMs = Date.now() - started;

  return {
    referenceAssessmentId,
    courseId,
    assemblyMode: 'metadata_similarity',
    createdAssessments: createdAssessments.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      semester: a.semester
    })),
    assemblyTimeMs,
    warnings,
    slotsProcessed: refVariants.length,
    examCount: examLabels.length
  };
}

function normalizeReasoningLevel(value) {
  if (value === 'analytical' || value === 'application' || value === 'factual') return value;
  return 'factual';
}

/** A, B, C, … for MCQ enforcement prompts (n ≤ 26). */
function mcqLetterSequence(n) {
  if (typeof n !== 'number' || n < 1 || n > 26) return '';
  return Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i)).join(', ');
}

/**
 * Promotes the first variant of each question to non-draft, then generates `variantsToAdd` alternate variants via EduAI.
 */
export async function generateBankVariantsForQuestions(userId, params) {
  const {
    questionIds,
    courseId,
    model = 'ollama:gpt-oss:120b',
    apiKeys = {},
    variantsToAdd = 1,
    variantPromptInstructions = null
  } = params;

  let extraInstructions = '';
  if (variantPromptInstructions != null && String(variantPromptInstructions).trim()) {
    const trimmed = String(variantPromptInstructions).trim().slice(0, 4000);
    extraInstructions = `\n\nAdditional instructions from the instructor (apply to this variant):\n"""\n${trimmed}\n"""\n`;
  }

  if (!courseId || !Array.isArray(questionIds) || questionIds.length === 0) {
    throw new Error('courseId and a non-empty questionIds array are required');
  }

  const course = await Course.findOne({
    where: { id: Number(courseId), userId },
    attributes: ['id', 'code', 'name']
  });

  if (!course) {
    throw new Error('Course not found');
  }

  if (!eduaiService.isConfigured()) {
    throw new Error('EduAI is not configured; cannot generate variants.');
  }

  const rawCode = (course.code && course.code.trim()) || `COURSE-${course.id}`;
  const courseCode = rawCode.replace(/\s+/g, '').toUpperCase();

  const topics = await Topics.findAll({
    where: { courseId: course.id },
    order: [['name', 'ASC']],
    attributes: ['id', 'name']
  });
  const topicLines =
    topics.length > 0 ? topics.map((tp) => `- [${tp.id}] ${tp.name}`).join('\n') : '';

  const results = [];
  const errors = [];

  for (const qid of questionIds) {
    const meta = await Question_Metadata.findOne({
      where: { id: qid, courseId: course.id },
      include: [
        {
          model: Variants,
          as: 'variants',
          separate: true,
          order: [['id', 'ASC']]
        }
      ]
    });

    if (!meta || !meta.variants?.length) {
      errors.push({ questionId: qid, error: 'Question not found or has no variants' });
      continue;
    }

    const primaryVariant = meta.variants[0];
    await primaryVariant.update({ isDraft: false });

    const createdVariantIds = [];

    for (let n = 0; n < variantsToAdd; n++) {
      const difficultyDistribution = {
        easy: primaryVariant.difficulty === 'easy' ? 1 : 0,
        medium: primaryVariant.difficulty === 'medium' ? 1 : 0,
        hard: primaryVariant.difficulty === 'hard' ? 1 : 0
      };
      const rl = primaryVariant.reasoningLevel || 'factual';
      const reasoningDistribution = {
        factual: rl === 'factual' ? 100 : 0,
        analytical: rl === 'analytical' ? 100 : 0,
        application: rl === 'application' ? 100 : 0
      };

      const expectedMcqChoiceCount =
        meta.type === 'MCQ' &&
        Array.isArray(primaryVariant.choices) &&
        primaryVariant.choices.length >= 2
          ? primaryVariant.choices.length
          : null;

      const mcqOriginalChoicesBlock =
        expectedMcqChoiceCount != null
          ? `Original MCQ has exactly ${expectedMcqChoiceCount} options (letters ${mcqLetterSequence(expectedMcqChoiceCount)}). Your variant MUST be MCQ with exactly ${expectedMcqChoiceCount} new options — same count, rewritten distractors and stem, same letter labels ${mcqLetterSequence(expectedMcqChoiceCount)}.\nOriginal options (for reference; do not copy verbatim):\n${JSON.stringify(primaryVariant.choices)}\n\n`
          : '';

      const baseVariantPrompt = `Create ONE alternate assessment variant of the following question. Preserve the same learning objective and approximate difficulty, but change surface details (values, scenario names, wording) so the item is not identical to the original.

Original type: ${meta.type}
Original question text:
"""
${primaryVariant.questionText}
"""

${mcqOriginalChoicesBlock}${topicLines ? `Course topics (use numeric IDs in output when applicable):\n${topicLines}\n` : ''}${extraInstructions}
Return exactly one question in the required JSON format.`;

      try {
        const callGenerate = (promptText) =>
          eduaiService.generateQuestions({
            prompt: promptText,
            courseCode,
            model,
            apiKeys,
            numQuestions: 1,
            difficultyDistribution,
            reasoningDistribution,
            ...(expectedMcqChoiceCount != null ? { mcqRequiredChoiceCount: expectedMcqChoiceCount } : {})
          });

        let generated = await callGenerate(baseVariantPrompt);

        let q = Array.isArray(generated) ? generated[0] : null;
        if (!q || !q.content) {
          throw new Error('EduAI returned no question content');
        }

        let answer = q.answer ?? null;
        let choices = q.choices ?? null;

        if (meta.type === 'MCQ' && expectedMcqChoiceCount != null) {
          const got = Array.isArray(choices) ? choices.length : 0;
          if (got !== expectedMcqChoiceCount) {
            const repair = `\n\nCRITICAL FIX: Your last output had ${got} MCQ choice(s). Regenerate with exactly ${expectedMcqChoiceCount} choices labeled ${mcqLetterSequence(expectedMcqChoiceCount)}. The original has ${expectedMcqChoiceCount} options; the variant must match that count.`;
            generated = await callGenerate(baseVariantPrompt + repair);
            q = Array.isArray(generated) ? generated[0] : null;
            if (!q || !q.content) {
              throw new Error('EduAI returned no question content on MCQ count retry');
            }
            answer = q.answer ?? null;
            choices = q.choices ?? null;
          }
        }

        if (meta.type === 'MCQ' && (!choices || choices.length < 2)) {
          throw new Error('MCQ variant missing choices');
        }
        if (meta.type === 'MCQ' && expectedMcqChoiceCount != null && choices.length !== expectedMcqChoiceCount) {
          throw new Error(
            `MCQ variant must have exactly ${expectedMcqChoiceCount} choices (same as original); model returned ${choices.length}. Try again or use another model.`
          );
        }

        const v = await Variants.create({
          questionMetadataId: meta.id,
          questionText: q.content.trim(),
          difficulty: ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : primaryVariant.difficulty,
          reasoningLevel: normalizeReasoningLevel(q.reasoning_level),
          answer,
          choices: meta.type === 'MCQ' ? choices : null,
          assessmentId: null,
          secondaryTopicsId: Array.isArray(primaryVariant.secondaryTopicsId)
            ? primaryVariant.secondaryTopicsId
            : [],
          referenceId: primaryVariant.id,
          isAiGenerated: true,
          isDraft: false
        });

        createdVariantIds.push(v.id);
      } catch (err) {
        errors.push({ questionId: qid, iteration: n + 1, error: err.message || String(err) });
        break;
      }
    }

    results.push({
      questionId: qid,
      promotedVariantId: primaryVariant.id,
      createdVariantIds
    });
  }

  return { results, errors, courseId: course.id };
}

/**
 * Strip ```json ... ``` (or plain ```) wrappers — common with non-Ollama chat models.
 * Handles leading prose (e.g. "Here is the JSON:") before the first fence.
 */
function stripMarkdownJsonFence(text) {
  let t = String(text ?? '').trim();
  if (!t) return '';
  const open = t.indexOf('```');
  if (open !== -1) {
    let inner = t.slice(open + 3);
    inner = inner.replace(/^(?:json)?\s*\r?\n?/i, '');
    const close = inner.indexOf('```');
    if (close !== -1) return inner.slice(0, close).trim();
  }
  return t;
}

/**
 * Extract first {...} with balanced braces, respecting JSON string quotes (models often add prose after JSON).
 */
function extractBalancedJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (c === '\\') {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function stripJsonTrailingCommas(s) {
  return s.replace(/,\s*([}\]])/g, '$1');
}

function parseJsonObjectFromText(raw) {
  let text = stripMarkdownJsonFence(String(raw ?? '').trim());
  if (!text) return null;

  const normalizeParsed = (parsed) => {
    if (parsed == null) return null;
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0] != null && typeof parsed[0] === 'object') {
      return parsed[0];
    }
    return typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  };

  const tryParse = (s) => {
    if (!s || typeof s !== 'string') return null;
    try {
      return normalizeParsed(JSON.parse(s));
    } catch {
      try {
        return normalizeParsed(JSON.parse(stripJsonTrailingCommas(s)));
      } catch {
        return null;
      }
    }
  };

  let parsed = tryParse(text);
  if (parsed) return parsed;

  const balanced = extractBalancedJsonObject(text);
  if (balanced) {
    parsed = tryParse(balanced);
    if (parsed) return parsed;
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const sliced = text.slice(start, end + 1);
    parsed = tryParse(sliced);
    if (parsed) return parsed;
  }

  return null;
}

function normalizeJudgeScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function normalizeUsability(value) {
  const v = String(value ?? '')
    .trim()
    .toLowerCase();
  if (v === 'usable_as_is') return 'usable_as_is';
  if (v === 'usable_with_edits') return 'usable_with_edits';
  return 'unusable';
}

/**
 * AI judge pass: compares one variant exam against baseline slot-by-slot and returns rubric scores.
 */
export async function reviewVariantExamWithAi(userId, params) {
  const {
    baselineAssessmentId,
    variantAssessmentId,
    courseId,
    model = 'ollama:gpt-oss:120b',
    apiKeys = {},
    rubricText = '',
    // If true, penalize low-usability slots when computing the overall score.
    applyUsabilityPenalty = true,
    // If true, ask the LLM for a short strengths/weaknesses summary.
    includeOverallSummary = true
  } = params;

  const reviewStartMs = Date.now();

  if (!baselineAssessmentId || !variantAssessmentId || !courseId) {
    throw new Error('baselineAssessmentId, variantAssessmentId, and courseId are required');
  }

  const baselineAssessment = await Assessments.findOne({
    where: { id: Number(baselineAssessmentId), courseId: Number(courseId) },
    include: [{ model: Course, as: 'course', where: { userId }, attributes: ['id'], required: true }]
  });
  if (!baselineAssessment) {
    throw new Error('Baseline assessment not found or course mismatch');
  }

  const variantAssessment = await Assessments.findOne({
    where: { id: Number(variantAssessmentId), courseId: Number(courseId) },
    include: [{ model: Course, as: 'course', where: { userId }, attributes: ['id'], required: true }]
  });
  if (!variantAssessment) {
    throw new Error('Variant assessment not found or course mismatch');
  }

  const baselineVariants = await loadOrderedVariantsForAssessment(baselineAssessment.id);
  const variantVariants = await loadOrderedVariantsForAssessment(variantAssessment.id);
  const pairCount = Math.min(baselineVariants.length, variantVariants.length);
  if (pairCount === 0) {
    throw new Error('Both assessments must have at least one question');
  }

  const rubric =
    String(rubricText || '').trim() ||
    [
      'Conceptual equivalence (1-5)',
      'Difficulty similarity (1-5)',
      'Structural validity (1-5)',
      'Answer correctness (1-5)',
      'Topic alignment (1-5)',
      'Variant distinctness (1-5)',
      '5: Substantially different while preserving concept',
      '4: Moderate changes',
      '3: Minor variation',
      '2: Very similar',
      '1: Near-duplicate',
      'Usability classification: usable_as_is | usable_with_edits | unusable'
    ].join('\n');

  const systemInstruction =
    'You are an expert university instructor evaluating whether a generated exam question variant preserves the intent of the original question. ' +
    'This is a grading/meta task: you compare two question texts. Do NOT solve the questions, do NOT pick multiple-choice letters (A/B/C/D), and do not explain which option is correct. ' +
    'Respond with one JSON object only: no markdown fences, no commentary before or after the JSON.';

  const perQuestion = [];
  for (let i = 0; i < pairCount; i++) {
    const original = baselineVariants[i];
    const generated = variantVariants[i];

    const userPrompt = `INSTRUCTOR REVIEW ONLY — Do not answer these items. Do not state "the correct answer is" or choose A/B/C/D. Output only the rubric JSON object described at the end.

Original Question (slot ${i + 1})
"""
${original.questionText ?? ''}
"""

Original answer:
${original.answer ?? '(none)'}
Original choices:
${Array.isArray(original.choices) && original.choices.length ? JSON.stringify(original.choices) : '(none)'}

Generated Variant (slot ${i + 1})
"""
${generated.questionText ?? ''}
"""

Generated answer:
${generated.answer ?? '(none)'}
Generated choices:
${Array.isArray(generated.choices) && generated.choices.length ? JSON.stringify(generated.choices) : '(none)'}

Task:
Evaluate the generated variant using the rubric below.

Rubric:
${rubric}

Output ONLY valid JSON with this exact schema (use straight double quotes, no trailing commas):
{
  "conceptual_equivalence": number,
  "difficulty_similarity": number,
  "structural_validity": number,
  "answer_correctness": number,
  "topic_alignment": number,
  "distinctness": number,
  "usability": "usable_as_is | usable_with_edits | unusable",
  "brief_reason": "one sentence explanation"
}`;

    const response = await eduaiService.chat({
      model,
      apiKeys,
      courseCode: `COURSE-${courseId}`,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userPrompt }
      ],
      streaming: false,
      timeoutMs: 120000
    });

    let content = response?.content ?? response?.message ?? '';
    let parsed = parseJsonObjectFromText(content);
    if (!parsed) {
      console.warn(`[reviewVariantExamWithAi] slot ${i + 1}: first JSON parse failed, retrying`, {
        model,
        preview: String(content).slice(0, 300).replace(/\s+/g, ' ')
      });
      const repairUser = `${userPrompt}

IMPORTANT — Your last answer was not valid JSON. Reply again with ONE JSON object only.
Do NOT solve the exam question or discuss which choice is correct — only compare original vs variant quality in the rubric fields.
Rules: no markdown, no code fences, no text before { or after }. Use double quotes on all keys and on brief_reason and usability. usability must be exactly usable_as_is OR usable_with_edits OR unusable (underscores). All six numeric fields must be integers 1–5.`;
      const retryResponse = await eduaiService.chat({
        model,
        apiKeys,
        courseCode: `COURSE-${courseId}`,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: repairUser }
        ],
        streaming: false,
        timeoutMs: 120000
      });
      content = retryResponse?.content ?? retryResponse?.message ?? '';
      parsed = parseJsonObjectFromText(content);
    }
    if (!parsed) {
      const preview = String(content ?? '')
        .slice(0, 500)
        .replace(/\s+/g, ' ');
      throw new Error(
        `AI judge returned invalid JSON for slot ${i + 1} after retry. Try another model or lower exam size. Preview: ${preview}`
      );
    }

    perQuestion.push({
      slot: i + 1,
      baselineVariantId: original.id,
      variantVariantId: generated.id,
      conceptual_equivalence: normalizeJudgeScore(parsed.conceptual_equivalence),
      difficulty_similarity: normalizeJudgeScore(parsed.difficulty_similarity),
      structural_validity: normalizeJudgeScore(parsed.structural_validity),
      answer_correctness: normalizeJudgeScore(parsed.answer_correctness),
      topic_alignment: normalizeJudgeScore(parsed.topic_alignment),
      distinctness: normalizeJudgeScore(parsed.distinctness),
      usability: normalizeUsability(parsed.usability),
      brief_reason: String(parsed.brief_reason ?? '').trim() || 'No reason provided.'
    });
  }

  const dimensions = [
    'conceptual_equivalence',
    'difficulty_similarity',
    'structural_validity',
    'answer_correctness',
    'topic_alignment'
  ];

  // Composite weights come directly from the rubric dimensions.
  // Conceptual equivalence gets a slightly higher weight than the other rubric dimensions.
  const compositeWeights = {
    conceptual_equivalence: 0.24,
    difficulty_similarity: 0.19,
    structural_validity: 0.19,
    answer_correctness: 0.19,
    topic_alignment: 0.19
  };

  // Usability multiplier is applied only as a penalty to the overall score (never changes per-dimension rubric scores).
  const usabilityMultiplier = {
    usable_as_is: 1.0,
    usable_with_edits: 0.9,
    unusable: 0.75
  };

  // Distinctness is a penalty dimension: lower distinctness => smaller factor.
  const distinctnessToFactor = {
    5: 1.0,
    4: 0.9,
    3: 0.7,
    2: 0.4,
    1: 0.1
  };

  function normalize1to5To0to100(score1to5) {
    if (!Number.isFinite(score1to5)) return null;
    const clamped = Math.max(1, Math.min(5, score1to5));
    return ((clamped - 1) / (5 - 1)) * 100;
  }

  function computeComposite1to5ForQuestion(question) {
    let weightedSum = 0;
    let usedWeight = 0;

    for (const dim of dimensions) {
      const v = question[dim];
      const w = compositeWeights[dim];
      if (typeof v === 'number' && Number.isFinite(v) && typeof w === 'number' && Number.isFinite(w)) {
        weightedSum += v * w;
        usedWeight += w;
      }
    }

    if (usedWeight <= 0) return null;
    return weightedSum / usedWeight;
  }

  for (const q of perQuestion) {
    const baseComposite1to5 = computeComposite1to5ForQuestion(q);
    q.exam_variant_composite_score_1to5 = baseComposite1to5;
    q.exam_variant_composite_score_0to100 = normalize1to5To0to100(baseComposite1to5);

    const distinctnessFactor = Number.isFinite(q.distinctness) ? distinctnessToFactor[q.distinctness] : null;
    q.exam_variant_distinctness_factor = typeof distinctnessFactor === 'number' ? distinctnessFactor : null;

    const multiplier = usabilityMultiplier[q.usability] ?? 1.0;
    const adjustedComposite1to5 =
      baseComposite1to5 == null ? null : Math.max(1, Math.min(5, baseComposite1to5 * multiplier));
    q.exam_variant_composite_score_1to5_usability_adjusted = adjustedComposite1to5;
    q.exam_variant_composite_score_0to100_usability_adjusted = normalize1to5To0to100(adjustedComposite1to5);
  }

  const baseCompositeValues = perQuestion
    .map((q) => q.exam_variant_composite_score_1to5)
    .filter((v) => typeof v === 'number' && Number.isFinite(v));

  const examVariantScoreBase1to5 = baseCompositeValues.length
    ? baseCompositeValues.reduce((a, b) => a + b, 0) / baseCompositeValues.length
    : null;

  const examVariantScoreBase0to100 = normalize1to5To0to100(examVariantScoreBase1to5);
  const distinctnessFactorValues = perQuestion
    .map((q) => q.exam_variant_distinctness_factor)
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  const distinctnessFactorAvg = distinctnessFactorValues.length ? distinctnessFactorValues.reduce((a, b) => a + b, 0) / distinctnessFactorValues.length : 1.0;

  const usabilityFactorValues = perQuestion
    .map((q) => usabilityMultiplier[q.usability] ?? 1.0)
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  const usabilityFactorAvg = usabilityFactorValues.length ? usabilityFactorValues.reduce((a, b) => a + b, 0) / usabilityFactorValues.length : 1.0;

  const examVariantScoreFinal0to100 =
    examVariantScoreBase0to100 == null
      ? null
      : Math.max(0, Math.min(100, examVariantScoreBase0to100 * distinctnessFactorAvg * (applyUsabilityPenalty ? usabilityFactorAvg : 1.0)));

  const examVariantScoreFinal1to5 =
    examVariantScoreFinal0to100 == null ? null : 1 + (examVariantScoreFinal0to100 / 100) * 4;

  const scoreAfterDistinctness0to100 = examVariantScoreBase0to100 == null ? null : examVariantScoreBase0to100 * distinctnessFactorAvg;
  const scoreAfterDistinctnessUsability0to100 =
    scoreAfterDistinctness0to100 == null ? null : scoreAfterDistinctness0to100 * (applyUsabilityPenalty ? usabilityFactorAvg : 1.0);

  const totalScoreCalculationSummary =
    scoreAfterDistinctness0to100 == null || examVariantScoreFinal0to100 == null
      ? null
      : `Final = Base(${examVariantScoreBase0to100.toFixed(1)}) × DistinctnessFactor(${distinctnessFactorAvg.toFixed(2)})${
          applyUsabilityPenalty ? ` × UsabilityFactor(${usabilityFactorAvg.toFixed(2)})` : ''
        } = ${scoreAfterDistinctnessUsability0to100.toFixed(1)} (clamped to ${examVariantScoreFinal0to100.toFixed(0)}/100)`;

  const distinctnessValues = perQuestion
    .map((q) => q.distinctness)
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  const distinctnessAverage1to5 = distinctnessValues.length ? distinctnessValues.reduce((a, b) => a + b, 0) / distinctnessValues.length : null;

  const averages = {};
  for (const key of dimensions) {
    const vals = perQuestion.map((q) => q[key]).filter((v) => Number.isFinite(v));
    averages[key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }

  const usabilityCounts = {
    usable_as_is: perQuestion.filter((q) => q.usability === 'usable_as_is').length,
    usable_with_edits: perQuestion.filter((q) => q.usability === 'usable_with_edits').length,
    unusable: perQuestion.filter((q) => q.usability === 'unusable').length
  };

  const usableQuestionCount = usabilityCounts.usable_as_is + usabilityCounts.usable_with_edits;
  const usableQuestionPercentage = pairCount ? (usableQuestionCount / pairCount) * 100 : 0;

  function fallbackOverallSummary() {
    const entries = dimensions
      .map((d) => ({ dim: d, avg: averages[d] }))
      .filter((x) => typeof x.avg === 'number' && Number.isFinite(x.avg))
      .sort((a, b) => b.avg - a.avg);

    const top = entries.slice(0, 2);
    const bottom = entries.slice(-2);

    const strengthBits = top.map((x) => `${x.dim.replaceAll('_', ' ')} (${x.avg.toFixed(2)}/5)`);
    const weaknessBits = bottom.map((x) => `${x.dim.replaceAll('_', ' ')} (${x.avg.toFixed(2)}/5)`);

    const usabilityWeakness =
      usabilityCounts.unusable > 0
        ? `Some slots were judged unusable (${usabilityCounts.unusable}/${pairCount}), so practical exam quality likely needs revision.`
        : usabilityCounts.usable_with_edits > 0
          ? `Several slots are workable but need edits (${usabilityCounts.usable_with_edits}/${pairCount}).`
          : 'All slots were judged usable (no unusable slots).';

    const distinctnessWeakness =
      typeof distinctnessAverage1to5 === 'number' && Number.isFinite(distinctnessAverage1to5) && distinctnessAverage1to5 <= 2.0
        ? `Variant distinctness is low (avg ${distinctnessAverage1to5.toFixed(2)}/5): changes look like near-duplicates; consider altering values, structure, or scenario.`
        : null;

    const baseWeaknesses = weaknessBits.length ? weaknessBits : ['At least one rubric dimension averaged lower across slots.'];

    return {
      summaryText: `Overall, the variant preserves the rubric intent with strength in ${strengthBits.join(', ') || 'rubric dimensions'}. ${usabilityWeakness}`,
      strengths: strengthBits.length ? strengthBits : ['Rubric dimensions were generally consistent across slots.'],
      weaknesses: distinctnessWeakness ? [...baseWeaknesses, distinctnessWeakness] : baseWeaknesses
    };
  }

  let overallSummary = null;
  if (includeOverallSummary) {
    const summarySystemInstruction =
      'You are an expert university instructor. Write short, actionable feedback about why an exam variant does or does not meet a rubric.';
    const summaryUserPrompt = `We compared a baseline exam against a generated variant, slot-by-slot, using this rubric:
${rubric}

Rubric dimension averages (1-5):
- conceptual_equivalence: ${averages.conceptual_equivalence ?? 'n/a'}
- difficulty_similarity: ${averages.difficulty_similarity ?? 'n/a'}
- structural_validity: ${averages.structural_validity ?? 'n/a'}
- answer_correctness: ${averages.answer_correctness ?? 'n/a'}
- topic_alignment: ${averages.topic_alignment ?? 'n/a'}

Usability (actionability):
- usable_as_is: ${usabilityCounts.usable_as_is}
- usable_with_edits: ${usabilityCounts.usable_with_edits}
- unusable: ${usabilityCounts.unusable}

Variant distinctness (penalty dimension):
- distinctnessAverage (1-5): ${distinctnessAverage1to5 ?? 'n/a'}
- distinctnessFactorAvg (multiplier): ${distinctnessFactorAvg ?? 'n/a'}

Overall composite score (0-100):
- base: ${examVariantScoreBase0to100 ?? 'n/a'}
- final: ${examVariantScoreFinal0to100 ?? 'n/a'}

Task:
Return ONLY valid JSON:
{
  "summaryText": "1-3 sentences, instructor-facing (mention strengths and weaknesses)",
  "strengths": ["2-4 short strings"],
  "weaknesses": ["2-4 short strings"]
}

If distinctnessAverage is low (near-duplicate/very similar), ensure at least one item in "weaknesses" explicitly mentions that the variant is too similar and should change values, structure, or scenario.

Do not include markdown fences. Keep strings concise.`;

    try {
      const response = await eduaiService.chat({
        model,
        apiKeys,
        courseCode: `COURSE-${courseId}`,
        messages: [
          { role: 'system', content: summarySystemInstruction },
          { role: 'user', content: summaryUserPrompt }
        ],
        streaming: false,
        timeoutMs: 60000
      });

      const content = response?.content ?? response?.message ?? '';
      const parsed = parseJsonObjectFromText(content);
      if (
        parsed &&
        typeof parsed.summaryText === 'string' &&
        Array.isArray(parsed.strengths) &&
        Array.isArray(parsed.weaknesses)
      ) {
        overallSummary = {
          summaryText: parsed.summaryText.trim(),
          strengths: parsed.strengths.map((s) => String(s).trim()).filter(Boolean).slice(0, 6),
          weaknesses: parsed.weaknesses.map((s) => String(s).trim()).filter(Boolean).slice(0, 6)
        };
      }
    } catch {
      overallSummary = null;
    }
  }

  if (!overallSummary) overallSummary = fallbackOverallSummary();

  const reviewTimeMs = Date.now() - reviewStartMs;

  return {
    baselineAssessmentId: baselineAssessment.id,
    variantAssessmentId: variantAssessment.id,
    courseId: Number(courseId),
    model,
    rubricUsed: rubric,
    reviewTimeMs,
    comparedSlots: pairCount,
    baselineSlotCount: baselineVariants.length,
    variantSlotCount: variantVariants.length,
    averages,
    usabilityCounts,
    usableQuestionPercentage,
    compositeWeights,
    usabilityMultiplier,
    distinctnessAverage1to5,
    distinctnessFactorAvg,
    distinctnessToFactor,
    usabilityFactorAvg,
    usabilityPenaltyApplied: Boolean(applyUsabilityPenalty),
    examVariantScoreBase1to5,
    examVariantScoreBase0to100,
    examVariantScoreFinal1to5,
    examVariantScoreFinal0to100,
    totalScoreCalculationSummary,
    overallSummary,
    perQuestion
  };
}
