/**
 * Question service providing CRUD for metadata/variants plus assessment ordering helpers.
 * Validates ownership via course relationships and keeps variant-topic links normalized.
 */
import { createId } from '@paralleldrive/cuid2';
import { prisma } from '../config/database.js';
import { config } from '../config/settings.js';
import {
  enrichRowsWithCourse,
  enrichRowWithCourse,
  formatSemesterDisplay
} from './courseListService.js';
import { buildQuestionListQuery } from '../utils/questionListQuery.js';
import {
  attachQuestionToBanks,
  listExternalQuestionIdsForBank,
} from './questionBankService.js';

/**
 * `saveExtractedQuestions` writes each question's metadata/variant/section-link
 * rows sequentially inside one interactive transaction (per-item topic
 * fallback lookups and FK chaining rule out a bulk `createMany`). Prisma's
 * interactive-transaction timeout defaults to 5s, which a large extraction
 * payload blows through (P2028), rolling back the whole upload. Reusing
 * `config.maxQuestions` bounds the batch to the same ceiling already enforced
 * for AI-generated batches, and `EXTRACT_SAVE_TX_TIMEOUT_MS` gives that
 * capped batch comfortable headroom.
 */
const EXTRACT_SAVE_TX_TIMEOUT_MS = 30_000;

/**
 * Overwrites each question row's nested `variant.assessment.semester` with the
 * value derived from the question's own course term (#1072 §4 step 8 / #1077).
 * A variant's assessment always shares the question's course (enforced at
 * write time — `addQuestionToAssessment` / assembly flows), so the course
 * already enriched onto the question row is reused; no extra Core fetch.
 */
function withDerivedVariantSemesters(row) {
  const semester = formatSemesterDisplay(row.course?.term, row.course?.year);
  const variants = Array.isArray(row.variants)
    ? row.variants.map((v) => (v.assessment ? { ...v, assessment: { ...v.assessment, semester } } : v))
    : row.variants;
  return variants === row.variants ? row : { ...row, variants };
}

/**
 * Normalizes a primary topic id into a non-empty CUID string, or null if absent/invalid.
 * Topics now use CUID string PKs; integer IDs from older flows are coerced to strings.
 */
export const normalizePrimaryTopicId = (value) => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  return null;
};

/**
 * Normalizes any acceptable topic input into an array of strings.
 * Topics now use CUID string PKs; integer IDs from older flows are coerced to strings.
 */
const normalizeSecondaryTopics = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string' && item.trim()) return item.trim();
        if (typeof item === 'number' && Number.isFinite(item)) return String(Math.trunc(item));
        return null;
      })
      .filter(Boolean);
  }

  if (value === undefined || value === null || value === '') {
    return [];
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return [String(Math.trunc(value))];
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

/**
 * Validates and normalizes MCQ choices array.
 * Returns normalized choices array or null if invalid.
 */
const validateMCQChoices = (choices, questionType) => {
  // Only validate for MCQ questions
  if (questionType !== 'MCQ') {
    return null;
  }

  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const normalized = choices
    .map((choice) => {
      if (typeof choice === 'object' && choice !== null) {
        const letter = typeof choice.letter === 'string' 
          ? choice.letter.toUpperCase().trim() 
          : null;
        const text = typeof choice.text === 'string' 
          ? choice.text.trim() 
          : '';
        
        if (letter && text && /^[A-Z]$/.test(letter)) {
          return { letter, text };
        }
      }
      return null;
    })
    .filter((choice) => choice !== null);

  // Ensure at least 2 choices and unique letters
  if (normalized.length < 2) {
    return null;
  }

  const seenLetters = new Set();
  const uniqueChoices = normalized.filter((choice) => {
    if (seenLetters.has(choice.letter)) {
      return false;
    }
    seenLetters.add(choice.letter);
    return true;
  });

  return uniqueChoices.length >= 2 ? uniqueChoices : null;
};

/**
 * Extracts just the letter from answer text for MCQ questions.
 * Handles formats like: "B", "B)", "B) Option B", etc.
 */
const extractAnswerLetter = (answer) => {
  if (!answer || typeof answer !== 'string') {
    return null;
  }

  const trimmed = answer.trim();
  const match = trimmed.match(/^([A-Za-z])/);
  return match ? match[1].toUpperCase() : trimmed;
};

/** Builds a short question description from available text fields so metadata looks tidy. */
const generateMetadataDescription = (questionText, summary, instructions) => {
  const candidate = [summary, instructions, questionText].find(
    (value) => typeof value === 'string' && value.trim().length > 0
  );

  if (!candidate) {
    return 'Question';
  }

  const normalized = candidate.replace(/\s+/g, ' ').trim();
  const sentenceMatch = normalized.match(/[^.!?]+[.!?]?/);
  const base = (sentenceMatch ? sentenceMatch[0] : normalized).trim();
  const words = base.split(' ');

  if (words.length <= 12) {
    return base;
  }

  return `${words.slice(0, 12).join(' ')}…`;
};

/** Creates question metadata after validating ownership, type, and topic IDs. */
export const createQuestion = async (userId, questionData) => {
  try {
    const {
      description,
      courseId,
      primaryTopicId,
      type = 'MCQ',
      questionOrder = {},
      questionBankId,
      questionBankIds,
    } = questionData;

    const normalizedDescription = typeof description === 'string' && description.trim()
      ? description.trim()
      : null;

    const parsedCourseId = Number(courseId);
    if (!Number.isInteger(parsedCourseId)) {
      throw new Error('Valid courseId is required');
    }

    const parsedPrimaryTopicId = normalizePrimaryTopicId(primaryTopicId);
    if (!parsedPrimaryTopicId) {
      throw new Error('Valid primaryTopicId is required');
    }

    const course = await prisma.course.findFirst({
      where: { id: parsedCourseId, userId },
      select: { id: true }
    });

    if (!course) {
      throw new Error('Course not found');
    }

    const allowedTypes = ['MCQ', 'SA', 'LA'];
    const normalizedType = allowedTypes.includes(type) ? type : 'MCQ';

    const question = await prisma.questionMetadata.create({
      data: {
        courseId: parsedCourseId,
        primaryTopicId: parsedPrimaryTopicId,
        type: normalizedType,
        description: normalizedDescription,
        questionOrder: questionOrder && typeof questionOrder === 'object' ? questionOrder : {},
        createdBy: questionData.createdBy ?? null
      }
    });

    // Soft-fail: Core banks require linked coreCourseId + service key
    await attachQuestionToBanks(parsedCourseId, userId, question.id, {
      questionBankId,
      questionBankIds,
    }).catch(() => null);

    return question;
  } catch (error) {
    throw error;
  }
};

/**
 * Enriches raw question rows with their Core-backed course projection and the
 * derived variant semesters. Exported so a batched reader (the export scan) can
 * pay the single Core catalog fetch inside `enrichRowsWithCourse` once for the
 * whole set instead of once per batch.
 */
export const enrichQuestionRows = async (rows) => {
  const enriched = await enrichRowsWithCourse(rows);
  return enriched.map(withDerivedVariantSemesters);
};

/**
 * Returns a paginated question list (with course + variant associations)
 * scoped to the requesting user. Shape: `{ items, total, limit, offset }` (#1040).
 *
 * Search matches description OR any variant's questionText. Type / difficulty /
 * reasoning / AI / draft filters and sortBy are applied in SQL before paging
 * so bank UI pagination stays correct (#1040 review).
 *
 * `enrich: false` returns the raw rows and skips `enrichRowsWithCourse`, whose
 * `getAllCoursesFromCore()` call is an uncached full-catalog fetch — callers
 * that page through in batches should skip it and run `enrichQuestionRows` once
 * over the assembled set (#1044 export).
 */
export const getQuestionsByUser = async (userId, options = {}) => {
  try {
    const {
      courseId,
      questionBankId,
      search,
      types,
      difficulties,
      reasoningLevels,
      aiGenerated,
      draftStatus,
      sortBy,
      limit = 50,
      offset = 0,
      enrich = true,
    } = options;
    const appliedLimit = Math.max(1, Number.parseInt(limit, 10) || 50);
    const appliedOffset = Math.max(0, Number.parseInt(offset, 10) || 0);

    const { where: filterWhere, orderBy } = buildQuestionListQuery({
      search,
      types,
      difficulties,
      reasoningLevels,
      aiGenerated,
      draftStatus,
      sortBy,
    });

    const whereClause = { ...filterWhere, course: { userId } };

    if (courseId) {
      const parsedCourseId = Number(courseId);
      if (Number.isInteger(parsedCourseId)) {
        whereClause.courseId = parsedCourseId;
      }
    }

    const parsedBankId =
      questionBankId !== undefined && questionBankId !== '' && questionBankId !== null
        ? String(questionBankId)
        : null;
    if (parsedBankId && whereClause.courseId) {
      const memberIds = await listExternalQuestionIdsForBank(
        whereClause.courseId,
        userId,
        parsedBankId,
      );
      whereClause.id = { in: memberIds.length ? memberIds : [-1] };
    }

    const [rows, count] = await Promise.all([
      prisma.questionMetadata.findMany({
        where: whereClause,
        include: {
          // `coreCourseId` feeds the Core projection below — `Course` has no
          // local name/code to select anymore (#1072 §4 step 10).
          course: { select: { id: true, coreCourseId: true } },
          variants: {
            select: {
              id: true, questionText: true, difficulty: true, reasoningLevel: true, answer: true,
              choices: true, assessmentId: true, secondaryTopicsId: true, referenceId: true,
              isAiGenerated: true, isDraft: true, createdAt: true, updatedAt: true,
              assessment: { select: { id: true, name: true, type: true } }
            }
          }
        },
        orderBy,
        take: appliedLimit,
        skip: appliedOffset,
      }),
      prisma.questionMetadata.count({ where: whereClause }),
    ]);

    const items = enrich
      ? (await enrichRowsWithCourse(rows)).map(withDerivedVariantSemesters)
      : rows;

    return {
      items,
      total: count,
      limit: appliedLimit,
      offset: appliedOffset,
    };
  } catch (error) {
    throw error;
  }
};

/** Fetches a single question with variants once the user-course relationship is confirmed. */
export const getQuestionById = async (questionId, userId) => {
  try {
    const question = await prisma.questionMetadata.findFirst({
      where: { id: Number(questionId), course: { userId } },
      include: {
        // `coreCourseId` feeds the Core projection below — `Course` has no
        // local name/code to select anymore (#1072 §4 step 10).
        course: { select: { id: true, coreCourseId: true } },
        variants: {
          select: {
            id: true, questionText: true, difficulty: true, reasoningLevel: true, answer: true,
            choices: true, assessmentId: true, secondaryTopicsId: true, referenceId: true,
            isAiGenerated: true, isDraft: true, createdAt: true, updatedAt: true,
            assessment: { select: { id: true, name: true, type: true } }
          }
        }
      }
    });

    if (!question) {
      throw new Error('Question not found');
    }

    return withDerivedVariantSemesters(await enrichRowWithCourse(question));
  } catch (error) {
    throw error;
  }
};

/** Updates metadata fields while ensuring provided IDs and types remain valid. */
export const updateQuestion = async (questionId, userId, updateData) => {
  try {
    const question = await prisma.questionMetadata.findFirst({
      where: { id: Number(questionId), course: { userId } }
    });

    if (!question) {
      throw new Error('Question not found');
    }

    const updates = { ...updateData };

    if (updates.description !== undefined) {
      const desc = updates.description;
      updates.description = typeof desc === 'string' && desc.trim()
        ? desc.trim()
        : null;
    }

    if (updates.courseId !== undefined) {
      const parsedCourseId = Number(updates.courseId);
      if (!Number.isInteger(parsedCourseId)) {
        throw new Error('Valid courseId is required');
      }

      const course = await prisma.course.findFirst({
        where: { id: parsedCourseId, userId },
        select: { id: true }
      });

      if (!course) {
        throw new Error('Course not found');
      }

      updates.courseId = parsedCourseId;
    }

    if (updates.primaryTopicId !== undefined) {
      const parsedPrimaryTopicId = normalizePrimaryTopicId(updates.primaryTopicId);
      if (!parsedPrimaryTopicId) {
        throw new Error('Valid primaryTopicId is required');
      }
      updates.primaryTopicId = parsedPrimaryTopicId;
    }

    if (updates.type !== undefined) {
      const allowedTypes = ['MCQ', 'SA', 'LA'];
      if (!allowedTypes.includes(updates.type)) {
        throw new Error(`Invalid question type. Allowed values: ${allowedTypes.join(', ')}`);
      }
    }

    if (updates.questionOrder !== undefined && typeof updates.questionOrder !== 'object') {
      throw new Error('questionOrder must be an object');
    }

    // isAiGenerated and isDraft are variant-level fields and should not be updated via updateQuestion
    // They should be updated via updateVariant instead
    if (updates.isAiGenerated !== undefined || updates.isDraft !== undefined) {
      throw new Error('isAiGenerated and isDraft are variant-level fields. Use updateVariant to update individual variants.');
    }

    // §19/#1080 post-review lock, extended: `type` and `primaryTopicId` feed the Core
    // push payload (coreWiringService.js `type`/`topicId`) exactly like a variant's
    // questionText/difficulty. Once any sibling variant is reviewed (isDraft:false)
    // and pushed, editing either here would silently diverge from the immutable Core
    // copy — so the SAME 409 VARIANT_LOCKED convention as the variants.js content
    // lock applies. Un-review the reviewed variant(s) first (which clears
    // coreQuestionId) to unlock these fields again.
    if (updates.type !== undefined || updates.primaryTopicId !== undefined) {
      const reviewedVariant = await prisma.variants.findFirst({
        where: { questionMetadataId: question.id, isDraft: false }
      });
      if (reviewedVariant) {
        throw Object.assign(new Error('VARIANT_LOCKED'), { status: 409 });
      }
    }

    const ALLOWED_QUESTION_UPDATE_FIELDS = ['description', 'courseId', 'primaryTopicId', 'type', 'questionOrder'];
    const data = Object.fromEntries(
      Object.entries(updates).filter(([key]) => ALLOWED_QUESTION_UPDATE_FIELDS.includes(key))
    );

    const updated = await prisma.questionMetadata.update({ where: { id: question.id }, data });
    return updated;
  } catch (error) {
    throw error;
  }
};

/** Deletes a question (and cascades variants) after verifying the user owns the course. */
export const deleteQuestion = async (questionId, userId) => {
  try {
    const question = await prisma.questionMetadata.findFirst({
      where: { id: Number(questionId), course: { userId } }
    });

    if (!question) {
      throw new Error('Question not found');
    }

    await prisma.questionMetadata.delete({ where: { id: question.id } });
    return true;
  } catch (error) {
    throw error;
  }
};

/** Bulk-creates multiple questions for approvals, short-circuiting on validation issues. */
export const createMultipleQuestions = async (userId, questionsData) => {
  try {
    const createdQuestions = [];

    for (const q of questionsData) {
      const rawDesc = q.description ?? q.content;
      const description = typeof rawDesc === 'string' && rawDesc.trim() ? rawDesc.trim() : null;
      const courseId = Number(q.courseId ?? q.classId);
      const primaryTopicId = q.primaryTopicId;
      const type = ['MCQ', 'SA', 'LA'].includes(q.type) ? q.type : 'MCQ';
      const questionOrder = q.questionOrder || {};

      const question = await createQuestion(userId, {
        description,
        courseId,
        primaryTopicId,
        type,
        questionOrder,
        createdBy: q.createdBy ?? null
      });

      createdQuestions.push(question);
    }

    return createdQuestions;
  } catch (error) {
    throw error;
  }
};

/**
 * Persists extracted questions/variants and optionally creates assessments/sections
 * for them. The optional `assessment.semester` on `payload` is ignored — `semester`
 * is no longer stored at all (#1072 §4 step 10/#1077); it's derived from the
 * course's Core term at the read seam (`withDerivedVariantSemesters` above).
 */
export const saveExtractedQuestions = async (userId, payload) => {
  const { courseId, primaryTopicId, topicName, questions, assessment, isAiGenerated = false, createdBy = null } = payload;

  if (!courseId) {
    throw new Error('courseId is required');
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('Questions array is required');
  }

  if (questions.length > config.maxQuestions) {
    throw new Error(`Cannot save more than ${config.maxQuestions} questions at once`);
  }

  const parsedCourseId = Number(courseId);

  const course = await prisma.course.findFirst({
    where: { id: parsedCourseId, userId },
    select: { id: true }
  });

  if (!course) {
    throw new Error('Course not found');
  }

  const { createdIds, createdAssessmentId } = await prisma.$transaction(async (tx) => {
    const courseId = parsedCourseId;
    const existingTopics = await tx.topics.findMany({
      where: { courseId }
    });
    const topicIdSet = new Set(existingTopics.map((topic) => topic.id));

    let fallbackTopicId = primaryTopicId || null;
    if (fallbackTopicId && !topicIdSet.has(fallbackTopicId)) {
      const fallbackTopic = await tx.topics.findFirst({
        where: { id: fallbackTopicId, courseId }
      });

      if (!fallbackTopic) {
        throw new Error('Primary topic not found for this course');
      }

      topicIdSet.add(fallbackTopicId);
    }

    const sanitizedTopicName = topicName ? topicName.trim() : '';

    const ensureFallbackTopic = async () => {
      if (fallbackTopicId && topicIdSet.has(fallbackTopicId)) {
        return fallbackTopicId;
      }

      if (sanitizedTopicName) {
        let topic = await tx.topics.findFirst({
          where: { name: sanitizedTopicName, courseId }
        });

        if (!topic) {
          topic = await tx.topics.create({
            data: { id: createId(), name: sanitizedTopicName, courseId }
          });
        }

        topicIdSet.add(topic.id);
        fallbackTopicId = topic.id;
        return fallbackTopicId;
      }

      if (topicIdSet.size === 0) {
        const autoTopic = await tx.topics.create({
          data: { id: createId(), name: 'Uploaded Questions', courseId }
        });
        topicIdSet.add(autoTopic.id);
        fallbackTopicId = autoTopic.id;
        return fallbackTopicId;
      }

      const firstTopic = existingTopics[0];
      fallbackTopicId = firstTopic ? firstTopic.id : null;
      return fallbackTopicId;
    };

    let createdAssessment = null;
    let createdSection = null;
    if (assessment) {
      const { type, name } = assessment;
      if (!type || !name) {
        throw new Error('Assessment type and name are required.');
      }
      createdAssessment = await tx.assessments.create({
        data: { type, name, courseId }
      });

      // Create a default section for the uploaded questions
      createdSection = await tx.assessmentSections.create({
        data: {
          assessmentId: createdAssessment.id,
          name: 'Uploaded Questions',
          description: 'Questions extracted from uploaded document',
          position: 0
        }
      });
    }

    const createdIds = [];
    let orderCounter = 1;

    for (const item of questions) {
      const questionText = typeof item.question === 'string' ? item.question.trim() : '';
      if (!questionText) {
        continue;
      }

      const difficulty = typeof item.difficulty === 'string'
        ? item.difficulty.toLowerCase().trim()
        : '';

      const questionType = typeof item.type === 'string' && ['MCQ', 'SA', 'LA'].includes(item.type)
        ? item.type
        : 'SA';

      const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
      if (!summary) {
        throw new Error('Each question must include an AI-generated summary.');
      }

      const summaryText = generateMetadataDescription(
        questionText,
        summary,
        item.instructions
      );

      let primaryTopicForQuestion = null;
      if (item.primaryTopicId !== undefined && item.primaryTopicId !== null) {
        const candidate = String(item.primaryTopicId);
        if (topicIdSet.has(candidate)) {
          primaryTopicForQuestion = candidate;
        }
      }

      if (!primaryTopicForQuestion) {
        const fallback = await ensureFallbackTopic();
        if (!fallback) {
          throw new Error('Unable to determine primary topic for question.');
        }
        primaryTopicForQuestion = fallback;
      }

      const secondaryTopics = normalizeSecondaryTopics(item.secondaryTopicIds)
        .filter((id) => topicIdSet.has(id) && id !== primaryTopicForQuestion);

      const metadata = await tx.questionMetadata.create({
        data: {
          description: summaryText,
          courseId,
          primaryTopicId: primaryTopicForQuestion,
          type: questionType,
          questionOrder: createdAssessment ? { [createdAssessment.id]: orderCounter } : {},
          createdBy
        }
      });

      // Handle choices for MCQ questions
      let choices = null;
      let answer = item.answer;
      
      if (questionType === 'MCQ') {
        // Validate choices if provided
        if (item.choices) {
          choices = validateMCQChoices(item.choices, questionType);
        }
        
        // Normalize answer to just letter for MCQ
        if (typeof answer === 'string' && answer.trim()) {
          answer = extractAnswerLetter(answer) || answer.trim();
        }
      } else if (typeof answer === 'string' && answer.trim()) {
        answer = answer.trim();
      } else {
        answer = null;
      }

      const variant = await tx.variants.create({
        data: {
          questionMetadataId: metadata.id,
          questionText,
          difficulty: ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium',
          answer,
          choices,
          assessmentId: createdAssessment ? createdAssessment.id : null,
          secondaryTopicsId: secondaryTopics,
          referenceId: null,
          isAiGenerated: Boolean(isAiGenerated),
          isDraft: true, // All new variants start as drafts
          createdBy
        }
      });

      // Link variant to section if assessment and section were created
      if (createdSection) {
        await tx.sectionVariants.create({
          data: {
            sectionId: createdSection.id,
            variantId: variant.id,
            displayOrder: orderCounter - 1
          }
        });
      }

      createdIds.push(metadata.id);
      if (createdAssessment) {
        orderCounter += 1;
      }
    }

    if (createdIds.length === 0) {
      throw new Error('No valid questions to save.');
    }

    return { createdIds, createdAssessmentId: createdAssessment ? createdAssessment.id : null };
  }, { timeout: EXTRACT_SAVE_TX_TIMEOUT_MS });

  const savedQuestions = await prisma.questionMetadata.findMany({
    where: { id: { in: createdIds }, course: { userId } },
    include: {
      // `coreCourseId` feeds the Core projection below — `Course` has no
      // local name/code to select anymore (#1072 §4 step 10).
      course: { select: { id: true, coreCourseId: true } },
      variants: true
    },
    orderBy: { createdAt: 'desc' }
  });

  return {
    questions: await enrichRowsWithCourse(savedQuestions),
    assessmentId: createdAssessmentId
  };
};

/** Aggregates counts of questions/variants/drafts for dashboard stats. */
/**
 * Aggregate question/variant stats for a user, optionally scoped to one course.
 * Used by the dashboard and Course Detail overview so meters aren't computed
 * from a single paginated page (#1040 review).
 */
export const getQuestionStats = async (userId, options = {}) => {
  try {
    const { courseId } = options;
    const metadataWhere = { course: { userId } };
    if (courseId != null && courseId !== '') {
      const parsedCourseId = Number(courseId);
      if (Number.isInteger(parsedCourseId)) {
        metadataWhere.courseId = parsedCourseId;
      }
    }

    const totalQuestions = await prisma.questionMetadata.count({
      where: metadataWhere,
    });

    const typeStatsRaw = await prisma.questionMetadata.groupBy({
      by: ['type'],
      where: metadataWhere,
      _count: { _all: true },
    });
    const typeStats = typeStatsRaw.map((row) => ({ type: row.type, count: row._count._all }));

    // Variant-level aggregates (difficulty / AI / reviewed) over the same scope.
    const variantRows = await prisma.variants.findMany({
      where: { questionMetadata: metadataWhere },
      select: {
        difficulty: true,
        isAiGenerated: true,
        isDraft: true,
        secondaryTopicsId: true,
        questionMetadata: {
          select: { id: true, type: true, primaryTopicId: true },
        },
      },
    });

    const difficultyCounts = { easy: 0, medium: 0, hard: 0 };
    let aiCount = 0;
    let humanCount = 0;
    let reviewedCount = 0;
    const usedTopicIds = new Set();

    for (const row of variantRows) {
      const d = String(row.difficulty ?? 'medium').toLowerCase();
      if (d === 'easy') difficultyCounts.easy += 1;
      else if (d === 'hard') difficultyCounts.hard += 1;
      else difficultyCounts.medium += 1;
      if (row.isAiGenerated) aiCount += 1;
      else humanCount += 1;
      if (!row.isDraft) reviewedCount += 1;

      const meta = row.questionMetadata;
      if (meta?.primaryTopicId) usedTopicIds.add(String(meta.primaryTopicId));
      const sec = row.secondaryTopicsId;
      if (Array.isArray(sec)) {
        for (const id of sec) usedTopicIds.add(String(id));
      }
    }

    return {
      totalQuestions,
      totalVariants: variantRows.length,
      typeStats,
      difficultyStats: [
        { difficulty: 'easy', count: difficultyCounts.easy },
        { difficulty: 'medium', count: difficultyCounts.medium },
        { difficulty: 'hard', count: difficultyCounts.hard },
      ],
      aiCount,
      humanCount,
      reviewedCount,
      usedTopicIds: [...usedTopicIds],
    };
  } catch (error) {
    throw error;
  }
};

/** Updates the per-assessment ordering map stored on a question metadata row. */
export const updateQuestionOrder = async (questionId, assessmentId, orderNumber, userId) => {
  try {
    const question = await prisma.questionMetadata.findFirst({
      where: { id: Number(questionId), course: { userId } }
    });

    if (!question) {
      throw new Error('Question not found');
    }

    // Get current questionOrder or initialize empty object
    const currentOrder = question.questionOrder || {};

    // Update the order for the specific assessment
    currentOrder[assessmentId] = orderNumber;

    // Update the question with new order
    const updated = await prisma.questionMetadata.update({
      where: { id: question.id },
      data: { questionOrder: currentOrder }
    });

    return updated;
  } catch (error) {
    throw error;
  }
};

/** Removes a question from a specific assessment’s order map and detaches variants if needed. */
export const removeQuestionFromAssessment = async (questionId, assessmentId, userId) => {
  try {
    const question = await prisma.questionMetadata.findFirst({
      where: { id: Number(questionId), course: { userId } }
    });

    if (!question) {
      throw new Error('Question not found');
    }

    // Get current questionOrder or initialize empty object
    const currentOrder = question.questionOrder || {};

    // Remove the assessment from the order
    delete currentOrder[assessmentId];

    // Update the question with new order
    const updated = await prisma.questionMetadata.update({
      where: { id: question.id },
      data: { questionOrder: currentOrder }
    });

    return updated;
  } catch (error) {
    throw error;
  }
};

// Variant Management Functions
/** Creates a variant for a question while validating course ownership and metadata. */
export const createVariant = async (questionId, variantData, userId) => {
  try {
    questionId = Number(questionId);
    // Verify user owns the question
    const question = await prisma.questionMetadata.findFirst({
      where: { id: questionId, course: { userId } }
    });

    if (!question) {
      throw new Error('Question not found');
    }

    const secondaryTopics = normalizeSecondaryTopics(variantData.secondaryTopicsId);
    const validReasoningLevels = ['factual', 'analytical', 'application'];
    const reasoningLevel = variantData.reasoningLevel && validReasoningLevels.includes(variantData.reasoningLevel)
      ? variantData.reasoningLevel
      : 'factual';

    // Handle choices for MCQ questions
    let choices = null;
    let answer = variantData.answer;
    
    if (question.type === 'MCQ') {
      if (variantData.choices !== undefined) {
        choices = validateMCQChoices(variantData.choices, question.type);
        // If choices are provided but invalid, throw error
        if (variantData.choices !== null && choices === null) {
          throw new Error('Invalid choices format for MCQ. Choices must be an array of objects with letter and text properties.');
        }
      }
      
      // Normalize answer to just letter for MCQ
      if (typeof answer === 'string' && answer.trim()) {
        answer = extractAnswerLetter(answer) || answer.trim();
      }
    } else if (typeof answer === 'string' && answer.trim()) {
      answer = answer.trim();
    } else {
      answer = null;
    }

    const variant = await prisma.variants.create({
      data: {
        questionMetadataId: questionId,
        questionText: variantData.questionText,
        difficulty: variantData.difficulty || 'medium',
        reasoningLevel,
        assessmentId: variantData.assessmentId != null ? Number(variantData.assessmentId) : null,
        secondaryTopicsId: secondaryTopics,
        answer,
        choices,
        referenceId: variantData.referenceId != null ? Number(variantData.referenceId) : null,
        isAiGenerated: variantData.isAiGenerated !== undefined ? Boolean(variantData.isAiGenerated) : false,
        isDraft: variantData.isDraft !== undefined ? Boolean(variantData.isDraft) : true,
        createdBy: variantData.createdBy ?? null
      }
    });

    return variant;
  } catch (error) {
    throw error;
  }
};

/** Updates a variant’s content/difficulty/associations, normalizing secondary topics. */
export const updateVariant = async (variantId, variantData, userId) => {
  try {
    variantId = Number(variantId);
    const variant = await prisma.variants.findFirst({
      where: { id: variantId, questionMetadata: { course: { userId } } },
      include: {
        questionMetadata: { select: { id: true, type: true } }
      }
    });

    if (!variant) {
      throw new Error('Variant not found');
    }

    // Handle choices and answer normalization for MCQ
    let normalizedChoices = variantData.choices;
    let normalizedAnswer = variantData.answer;
    
    if (variant.questionMetadata && variant.questionMetadata.type === 'MCQ') {
      if (variantData.choices !== undefined) {
        normalizedChoices = validateMCQChoices(variantData.choices, 'MCQ');
        // If choices are provided but invalid, throw error
        if (variantData.choices !== null && normalizedChoices === null) {
          throw new Error('Invalid choices format for MCQ. Choices must be an array of objects with letter and text properties.');
        }
      }
      
      // Normalize answer to just letter for MCQ
      if (variantData.answer !== undefined && typeof variantData.answer === 'string' && variantData.answer.trim()) {
        normalizedAnswer = extractAnswerLetter(variantData.answer) || variantData.answer.trim();
      }
    } else if (variantData.answer !== undefined && typeof variantData.answer === 'string' && variantData.answer.trim()) {
      normalizedAnswer = variantData.answer.trim();
    }

    const nextIsDraft = variantData.isDraft !== undefined ? Boolean(variantData.isDraft) : undefined;
    // #1080 un-review: reopening a reviewed variant back to draft must clear its Core
    // link so the next approval re-pushes a fresh copy instead of the state-based push
    // guard (`variants.js` — `isDraft === false && !variant.coreQuestionId`) skipping it
    // as "already linked". Only fires on the false→true transition (not a no-op resend).
    const unreviewing = variant.isDraft === false && nextIsDraft === true;

    const ALLOWED_VARIANT_UPDATE_FIELDS = [
      'questionText', 'difficulty', 'reasoningLevel', 'assessmentId', 'secondaryTopicsId',
      'answer', 'choices', 'referenceId', 'isAiGenerated', 'isDraft', 'coreQuestionId'
    ];
    const normalizedData = {
      ...Object.fromEntries(
        Object.entries(variantData).filter(([key]) => ALLOWED_VARIANT_UPDATE_FIELDS.includes(key))
      ),
      ...(variantData.assessmentId !== undefined && {
        assessmentId: variantData.assessmentId != null ? Number(variantData.assessmentId) : null
      }),
      ...(variantData.referenceId !== undefined && {
        referenceId: variantData.referenceId != null ? Number(variantData.referenceId) : null
      }),
      ...(variantData.secondaryTopicsId !== undefined && {
        secondaryTopicsId: normalizeSecondaryTopics(variantData.secondaryTopicsId)
      }),
      ...(variantData.isAiGenerated !== undefined && {
        isAiGenerated: Boolean(variantData.isAiGenerated)
      }),
      ...(nextIsDraft !== undefined && {
        isDraft: nextIsDraft
      }),
      ...(normalizedChoices !== undefined && {
        choices: normalizedChoices
      }),
      ...(normalizedAnswer !== undefined && {
        answer: normalizedAnswer
      }),
      ...(unreviewing && {
        coreQuestionId: null
      })
    };

    // `variants.js`'s post-approval Core push reads `variant.questionMetadata.course.coreCourseId`
    // off this return value — must include it, not just the bare row.
    const updated = await prisma.variants.update({
      where: { id: variant.id },
      data: normalizedData,
      include: {
        questionMetadata: {
          select: { id: true, type: true, primaryTopicId: true, course: { select: { id: true, coreCourseId: true } } }
        }
      }
    });
    return updated;
  } catch (error) {
    throw error;
  }
};

/** Deletes a variant and cleans up related section links if the user owns the question. */
export const deleteVariant = async (variantId, userId) => {
  try {
    const variant = await prisma.variants.findFirst({
      where: { id: Number(variantId), questionMetadata: { course: { userId } } }
    });

    if (!variant) {
      throw new Error('Variant not found');
    }

    await prisma.variants.delete({ where: { id: variant.id } });
    return true;
  } catch (error) {
    throw error;
  }
};

/** Lists all variants for a question, including assessment context, for the owning user. */
export const getVariantsByQuestion = async (questionId, userId) => {
  try {
    questionId = Number(questionId);
    // Verify user owns the question
    const question = await prisma.questionMetadata.findFirst({
      where: { id: questionId, course: { userId } }
    });

    if (!question) {
      throw new Error('Question not found');
    }

    const variants = await prisma.variants.findMany({
      where: { questionMetadataId: questionId },
      // `id` breaks ties so the ordering is total (#1044). `createdAt` is not
      // unique — bank generation inserts a question's variants in one statement,
      // so they share a timestamp — and paging a non-total order can repeat and
      // drop rows across requests.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });

    return variants;
  } catch (error) {
    throw error;
  }
};
