/**
 * Assessment service encapsulating CRUD operations plus question/section associations.
 * Ensures user ownership via course joins and keeps question ordering metadata consistent.
 */
import { prisma } from "../config/database.js";
import {
  enrichRowsWithCourse,
  enrichRowWithCourse,
  formatSemesterDisplay,
  deriveSemesterDisplayForCourseId
} from './courseListService.js';
import {
  normalizeQuestionOrder,
  requirePositiveSafeInteger,
} from '../utils/questionOrder.js';

/**
 * Overwrites the transitional `semester` column value with the display string
 * derived from the row's (already-enriched) course term/year (#1072 §4 step 8 /
 * #1077). `semester` is never trusted as authoritative on read — every returned
 * assessment recomputes it here.
 */
function withDerivedSemester(row) {
  if (!row) return row;
  return { ...row, semester: formatSemesterDisplay(row.course?.term, row.course?.year) };
}

/**
 * Creates an assessment blueprint for the given user/course after validating inputs.
 * `semester` is no longer accepted from callers, nor persisted — the `Assessments`
 * table dropped the column (#1072 §4 step 10/#1077). It's still derived from the
 * course's Core term for the immediate create-response (mirrors `withDerivedSemester`
 * for the read seams); pass `cookie` to read through as the caller when available
 * (falls back to the service key).
 */
export const createAssessment = async (userId, assessmentData, { cookie } = {}) => {
  const { type, name, courseId, description, blueprintConfig } = assessmentData;

  if (!type || !name) {
    throw new Error("Type and name are required");
  }

  if (!courseId) {
    throw new Error("Course ID is required");
  }

  const parsedCourseId = Number(courseId);

  const course = await prisma.course.findFirst({
    where: { id: parsedCourseId, userId },
    select: { id: true },
  });

  if (!course) {
    throw new Error("Course not found");
  }

  const semesterDisplay = await deriveSemesterDisplayForCourseId(parsedCourseId, { cookie });

  const assessment = await prisma.assessments.create({
    data: {
      type,
      name,
      courseId: parsedCourseId,
      description: description?.trim() || null,
      blueprintConfig: blueprintConfig || null,
    },
  });

  return { ...assessment, semester: semesterDisplay };
};

/** Lists assessments owned by a user with optional filters and eager-loaded relations.
 * Returns `{ items, total, limit, offset }` (#1040).
 */
export const getAssessmentsByUser = async (userId, options = {}) => {
  const { limit = 50, offset = 0, courseId, isAdmin = false } = options;
  const appliedLimit = Math.max(1, Number.parseInt(limit, 10) || 50);
  const appliedOffset = Math.max(0, Number.parseInt(offset, 10) || 0);

  // If user is admin without a courseId constraint, allow all assessments; otherwise scope to owner
  const courseWhere = isAdmin ? {} : { userId };

  const where = {
    ...(courseId && { courseId }),
    // `coreCourseId` is what `enrichRowsWithCourse` needs to project
    // name/code from Core below — `Course` has no local name/code to
    // select anymore (#1072 §4 step 10).
    course: { ...courseWhere },
  };

  const [rows, count] = await Promise.all([
    prisma.assessments.findMany({
      where,
      include: {
        course: { select: { id: true, coreCourseId: true } },
        variants: {
          select: {
            id: true,
            questionText: true,
            difficulty: true,
            answer: true,
            choices: true,
            selectAllThatApply: true,
            correctAnswers: true,
            questionMetadataId: true,
            isAiGenerated: true,
            isDraft: true,
            questionMetadata: {
              select: {
                id: true,
                description: true,
                type: true,
                questionOrder: true,
                course: { select: { id: true } },
              },
            },
          },
        },
        sections: {
          orderBy: { position: "asc" },
          include: {
            sectionVariants: {
              include: {
                variant: {
                  select: {
                    id: true,
                    questionText: true,
                    difficulty: true,
                    reasoningLevel: true,
                    answer: true,
                    choices: true,
                    selectAllThatApply: true,
                    correctAnswers: true,
                    questionMetadataId: true,
                    isAiGenerated: true,
                    isDraft: true,
                    questionMetadata: {
                      select: {
                        id: true,
                        description: true,
                        type: true,
                        questionOrder: true,
                        course: { select: { id: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: appliedLimit,
      skip: appliedOffset,
    }),
    prisma.assessments.count({ where }),
  ]);

  const enriched = await enrichRowsWithCourse(rows);
  return {
    items: enriched.map(withDerivedSemester),
    total: count,
    limit: appliedLimit,
    offset: appliedOffset,
  };
};

/** Fetches a single assessment with its sections/variants if the user owns it. */
export const getAssessmentById = async (assessmentId, userId) => {
  const assessment = await prisma.assessments.findFirst({
    where: { id: Number(assessmentId), course: { userId } },
    include: {
      // `coreCourseId` feeds `enrichRowWithCourse`'s Core projection below.
      course: { select: { id: true, coreCourseId: true } },
      variants: {
        select: {
          id: true,
          questionText: true,
          difficulty: true,
          answer: true,
          choices: true,
          selectAllThatApply: true,
          correctAnswers: true,
          questionMetadataId: true,
          isAiGenerated: true,
          isDraft: true,
          questionMetadata: {
            select: {
              id: true,
              description: true,
              type: true,
              questionOrder: true,
              course: { select: { id: true } },
            },
          },
        },
      },
      sections: {
        include: {
          sectionVariants: {
            include: {
              variant: {
                select: {
                  id: true,
                  questionText: true,
                  difficulty: true,
                  reasoningLevel: true,
                  answer: true,
                  choices: true,
                  selectAllThatApply: true,
                  correctAnswers: true,
                  questionMetadataId: true,
                  isAiGenerated: true,
                  isDraft: true,
                  questionMetadata: {
                    select: {
                      id: true,
                      description: true,
                      type: true,
                      questionOrder: true,
                      course: { select: { id: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!assessment) {
    throw new Error("Assessment not found");
  }

  return withDerivedSemester(await enrichRowWithCourse(assessment));
};

/** Updates assessment metadata/blueprint while enforcing ownership and valid course references. */
export const updateAssessment = async (assessmentId, updateData, userId) => {
  const assessment = await prisma.assessments.findFirst({
    where: { id: Number(assessmentId), course: { userId } },
  });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    if (updateData.courseId !== undefined) {
      const parsedCourseId = Number(updateData.courseId);
      if (!Number.isInteger(parsedCourseId) || parsedCourseId <= 0) {
        throw new Error('Valid courseId is required');
      }

      // Course relocation is intentionally not a supported primitive. An
      // assessment carries variants, section links, and question-order state;
      // moving only its course row would leave those relations cross-course.
      // The route checks caller access to the requested target first, while
      // this service guard remains authoritative for direct callers and
      // same-owner ID-knowledge cases.
      if (parsedCourseId !== assessment.courseId) {
        throw Object.assign(new Error('Assessment course relocation is not supported'), {
          status: 409,
          code: 'COURSE_RELOCATION_NOT_ALLOWED',
          isPublic: true,
        });
      }

      const targetCourse = await prisma.course.findFirst({
        where: { id: parsedCourseId, userId },
        select: { id: true }
      });

      if (!targetCourse) {
        throw new Error('Course not found');
      }

      updateData = { ...updateData, courseId: parsedCourseId };
    }

    // `semester` is derived-only (#1072 §4 step 8 / #1077) — never write it,
    // even if a legacy caller still sends one.
    const ALLOWED_ASSESSMENT_UPDATE_FIELDS = ['type', 'name', 'courseId', 'description', 'blueprintConfig'];
    const { semester: _ignoredSemester, ...updateFields } = updateData;
    const normalizedUpdates = {
      ...Object.fromEntries(
        Object.entries(updateFields).filter(([key]) => ALLOWED_ASSESSMENT_UPDATE_FIELDS.includes(key))
      ),
      ...(updateData.courseId !== undefined && { courseId: Number(updateData.courseId) }),
      description: updateData.description !== undefined
        ? (updateData.description?.trim() || null)
        : assessment.description,
      blueprintConfig: updateData.blueprintConfig !== undefined
        ? updateData.blueprintConfig
        : assessment.blueprintConfig
    };

    // `include: { course: true }` returns the POST-update course relation — if
    // the update moved the assessment to another course, the response's
    // course/semester projection describes the NEW course (no separate reload
    // needed, unlike Sequelize's `.update()` + `.reload()` two-step).
    const updated = await prisma.assessments.update({
      where: { id: assessment.id },
      data: normalizedUpdates,
      include: { course: true }
    });

    return withDerivedSemester(await enrichRowWithCourse(updated));
  } catch (error) {
    throw error;
  }

  if (updateData.courseId) {
    const targetCourse = await prisma.course.findFirst({
      where: { id: Number(updateData.courseId), userId },
      select: { id: true },
    });

    if (!targetCourse) {
      throw new Error("Course not found");
    }
  }

  // `semester` is derived-only (#1072 §4 step 8 / #1077) — never write it,
  // even if a legacy caller still sends one.
  const ALLOWED_ASSESSMENT_UPDATE_FIELDS = [
    "type",
    "name",
    "courseId",
    "description",
    "blueprintConfig",
  ];
  const { semester: _ignoredSemester, ...updateFields } = updateData;
  const normalizedUpdates = {
    ...Object.fromEntries(
      Object.entries(updateFields).filter(([key]) =>
        ALLOWED_ASSESSMENT_UPDATE_FIELDS.includes(key),
      ),
    ),
    ...(updateData.courseId !== undefined && { courseId: Number(updateData.courseId) }),
    description:
      updateData.description !== undefined
        ? updateData.description?.trim() || null
        : assessment.description,
    blueprintConfig:
      updateData.blueprintConfig !== undefined
        ? updateData.blueprintConfig
        : assessment.blueprintConfig,
  };

  // `include: { course: true }` returns the POST-update course relation — if
  // the update moved the assessment to another course, the response's
  // course/semester projection describes the NEW course (no separate reload
  // needed, unlike Sequelize's `.update()` + `.reload()` two-step).
  const updated = await prisma.assessments.update({
    where: { id: assessment.id },
    data: normalizedUpdates,
    include: { course: true },
  });

  return withDerivedSemester(await enrichRowWithCourse(updated));
};

/**
 * Deletes an assessment and detaches any linked variants first. schema.prisma declares
 * `variants.assessmentId` as `onDelete: SetNull`, but that FK action only exists on databases
 * that ran 20260723215902_init's DDL for real — a database baselined from the pre-Prisma
 * Sequelize schema (see scripts/baselineExistingDatabase.js) may still have whatever FK action
 * `sequelize.sync` produced (NO ACTION) until the adoption migration's reconciliation runs.
 * Nulling explicitly keeps delete correct independent of which FK action is actually in place.
 */
export const deleteAssessment = async (assessmentId, userId) => {
  const assessment = await prisma.assessments.findFirst({
    where: { id: Number(assessmentId), course: { userId } },
  });

  if (!assessment) {
    throw new Error("Assessment not found");
  }

  await prisma.variants.updateMany({
    where: { assessmentId: assessment.id },
    data: { assessmentId: null },
  });

  await prisma.assessments.delete({ where: { id: assessment.id } });
  return true;
};

/** Adds a question to an assessment by updating its per-assessment `questionOrder`. */
export const addQuestionToAssessment = async (assessmentId, questionId, orderNumber, userId) => {
  try {
    const parsedAssessmentId = requirePositiveSafeInteger(assessmentId, 'Assessment ID');
    const parsedOrderNumber = requirePositiveSafeInteger(orderNumber, 'Order number');
    const parsedQuestionId = requirePositiveSafeInteger(questionId, 'Question ID');

    // Verify user owns the question
    const question = await prisma.questionMetadata.findFirst({
      where: { id: parsedQuestionId, course: { userId } }
    });

    if (!question) {
      throw new Error('Question not found');
    }

    // Verify assessment exists and belongs to user
    const assessment = await prisma.assessments.findFirst({
      where: { id: parsedAssessmentId, course: { userId } }
    });
    if (!assessment) {
      throw new Error('Assessment not found');
    }

    // The question and assessment must live in the same course — owner scoping alone
    // would let a question from another course the user owns be linked here (#1).
    if (question.courseId !== assessment.courseId) {
      throw new Error('Question not found');
    }

    // Update question order
    const currentOrder = normalizeQuestionOrder(question.questionOrder || {});
    currentOrder[String(parsedAssessmentId)] = parsedOrderNumber;
    const orderAssessmentIds = Object.keys(currentOrder).map(Number);
    const validOrderAssessments = await prisma.assessments.findMany({
      where: { id: { in: orderAssessmentIds }, courseId: assessment.courseId },
      select: { id: true },
    });
    if (validOrderAssessments.length !== orderAssessmentIds.length) {
      throw new Error('Assessment not found for this course');
    }

    const updated = await prisma.questionMetadata.update({
      where: { id: question.id },
      data: { questionOrder: currentOrder }
    });

    return updated;
  } catch (error) {
    throw error;
  }

  // Verify assessment exists and belongs to user
  const assessment = await prisma.assessments.findFirst({
    where: { id: assessmentId, course: { userId } },
  });
  if (!assessment) {
    throw new Error("Assessment not found");
  }

  // The question and assessment must live in the same course — owner scoping alone
  // would let a question from another course the user owns be linked here (#1).
  if (question.courseId !== assessment.courseId) {
    throw new Error("Question not found");
  }

  // Update question order
  const currentOrder = question.questionOrder || {};
  currentOrder[assessmentId] = orderNumber;

  const updated = await prisma.questionMetadata.update({
    where: { id: question.id },
    data: { questionOrder: currentOrder },
  });

  return updated;
};

/** Removes a question from an assessment's ordering payload after verifying ownership. */
export const removeQuestionFromAssessment = async (assessmentId, questionId, userId) => {
  try {
    const parsedAssessmentId = requirePositiveSafeInteger(assessmentId, 'Assessment ID');
    const parsedQuestionId = requirePositiveSafeInteger(questionId, 'Question ID');
    // Verify user owns the question
    const question = await prisma.questionMetadata.findFirst({
      where: { id: parsedQuestionId, course: { userId } }
    });

    if (!question) {
      throw new Error('Question not found');
    }

    // Verify assessment belongs to the user
    const assessment = await prisma.assessments.findFirst({
      where: { id: parsedAssessmentId, course: { userId } }
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    // The question and assessment must live in the same course (#1).
    if (question.courseId !== assessment.courseId) {
      throw new Error('Question not found');
    }

    // Remove from question order
    const currentOrder = {
      ...(question.questionOrder && typeof question.questionOrder === 'object' && !Array.isArray(question.questionOrder)
        ? question.questionOrder
        : {}),
    };
    delete currentOrder[String(parsedAssessmentId)];

    const updated = await prisma.questionMetadata.update({
      where: { id: question.id },
      data: { questionOrder: currentOrder }
    });

    return updated;
  } catch (error) {
    throw error;
  }

  // Verify assessment belongs to the user
  const assessment = await prisma.assessments.findFirst({
    where: { id: assessmentId, course: { userId } },
  });

  if (!assessment) {
    throw new Error("Assessment not found");
  }

  // The question and assessment must live in the same course (#1).
  if (question.courseId !== assessment.courseId) {
    throw new Error("Question not found");
  }

  // Remove from question order
  const currentOrder = question.questionOrder || {};
  delete currentOrder[assessmentId];

  const updated = await prisma.questionMetadata.update({
    where: { id: question.id },
    data: { questionOrder: currentOrder },
  });

  return updated;
};

/** Returns questions scheduled for a given assessment ordered by their stored display order. */
export const getQuestionsInAssessment = async (assessmentId, userId) => {
  try {
    const parsedAssessmentId = requirePositiveSafeInteger(assessmentId, 'Assessment ID');
    // Verify assessment exists and belongs to user
    const assessment = await prisma.assessments.findFirst({
      where: { id: parsedAssessmentId, course: { userId } }
    });
    if (!assessment) {
      throw new Error('Assessment not found');
    }

    // `question_order` is a `json` column (not `jsonb`), so the `@>` containment
    // operator is unavailable. Use `->>` key extraction, which works on `json`
    // and mirrors the ORDER BY clause below. Both the key and the ownership
    // filter are bound as query parameters (Prisma's tagged-template
    // `$queryRaw`), not string-interpolated into the SQL.
    //
    // `qm.id` breaks ties so the ordering is total (#1044). The display order in
    // `question_order` is not guaranteed unique — a bulk add writes the same
    // index to several rows — and without a tiebreak tied rows can shuffle
    // between requests, so a LIMIT/OFFSET page can repeat and drop them.
    const assessmentKey = String(parsedAssessmentId);
    const orderedRows = await prisma.$queryRaw`
      SELECT qm.id
      FROM question_metadata qm
      JOIN courses c ON c.id = qm.course_id
      WHERE c.user_id = ${userId}
        AND qm.course_id = ${assessment.courseId}
        AND qm.question_order ->> ${assessmentKey} IS NOT NULL
        AND qm.question_order ->> ${assessmentKey} ~ '^[0-9]+$'
      ORDER BY CASE
        WHEN qm.question_order ->> ${assessmentKey} ~ '^[0-9]+$'
        THEN CAST(qm.question_order ->> ${assessmentKey} AS NUMERIC)
        ELSE NULL
      END ASC, qm.id ASC
    `;
    const orderedIds = orderedRows.map((row) => row.id);

  if (orderedIds.length === 0) {
    return [];
  }

    // Get all questions that have this assessment in their questionOrder
    const questions = await prisma.questionMetadata.findMany({
      where: { id: { in: orderedIds }, courseId: assessment.courseId },
      include: {
        // Ownership filter only — this endpoint returns rows unenriched, and
        // `Course` has no local name/code to select anymore (#1072 §4 step 10).
        course: { select: { id: true } },
        variants: {
          where: { assessmentId: parsedAssessmentId },
          select: {
            id: true, questionText: true, difficulty: true, answer: true, choices: true,
            selectAllThatApply: true, correctAnswers: true,
          }
        }
      }
    }
  });

  // `findMany({ where: { id: { in } } })` doesn't preserve `in`-list order —
  // re-sort to match the CAST(question_order->>...) ordering computed above.
  const byId = new Map(questions.map((q) => [q.id, q]));
  return orderedIds.map((id) => byId.get(id)).filter(Boolean);
};
