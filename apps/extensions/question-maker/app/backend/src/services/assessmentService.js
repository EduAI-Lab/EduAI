/**
 * Assessment service encapsulating CRUD operations plus question/section associations.
 * Ensures user ownership via course joins and keeps question ordering metadata consistent.
 */
import { prisma } from '../config/database.js';
import {
  enrichRowsWithCourse,
  enrichRowWithCourse,
  formatSemesterDisplay,
  deriveSemesterDisplayForCourseId
} from './courseListService.js';

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
  try {
    const { type, name, courseId, description, blueprintConfig } = assessmentData;

    if (!type || !name) {
      throw new Error('Type and name are required');
    }

    if (!courseId) {
      throw new Error('Course ID is required');
    }

    const parsedCourseId = Number(courseId);

    const course = await prisma.course.findFirst({
      where: { id: parsedCourseId, userId },
      select: { id: true }
    });

    if (!course) {
      throw new Error('Course not found');
    }

    const semesterDisplay = await deriveSemesterDisplayForCourseId(parsedCourseId, { cookie });

    const assessment = await prisma.assessments.create({
      data: {
        type,
        name,
        courseId: parsedCourseId,
        description: description?.trim() || null,
        blueprintConfig: blueprintConfig || null
      }
    });

    return { ...assessment, semester: semesterDisplay };
  } catch (error) {
    throw error;
  }
};

/** Lists assessments owned by a user with optional filters and eager-loaded relations. */
export const getAssessmentsByUser = async (userId, options = {}) => {
  try {
    const { limit = 50, offset = 0, courseId, isAdmin = false } = options;

    // If user is admin without a courseId constraint, allow all assessments; otherwise scope to owner
    const courseWhere = isAdmin ? {} : { userId };

    const assessments = await prisma.assessments.findMany({
      where: {
        ...(courseId && { courseId }),
        // `coreCourseId` is what `enrichRowsWithCourse` needs to project
        // name/code from Core below — `Course` has no local name/code to
        // select anymore (#1072 §4 step 10).
        course: { ...courseWhere }
      },
      include: {
        course: { select: { id: true, coreCourseId: true } },
        variants: {
          select: {
            id: true, questionText: true, difficulty: true, answer: true, choices: true,
            questionMetadataId: true, isAiGenerated: true, isDraft: true,
            questionMetadata: {
              select: {
                id: true, description: true, type: true, questionOrder: true,
                course: { select: { id: true } }
              }
            }
          }
        },
        sections: {
          orderBy: { position: 'asc' },
          include: {
            sectionVariants: {
              include: {
                variant: {
                  select: {
                    id: true, questionText: true, difficulty: true, reasoningLevel: true, answer: true, choices: true,
                    questionMetadataId: true, isAiGenerated: true, isDraft: true,
                    questionMetadata: {
                      select: {
                        id: true, description: true, type: true, questionOrder: true,
                        course: { select: { id: true } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset)
    });

    const enriched = await enrichRowsWithCourse(assessments);
    return enriched.map(withDerivedSemester);
  } catch (error) {
    throw error;
  }
};

/** Fetches a single assessment with its sections/variants if the user owns it. */
export const getAssessmentById = async (assessmentId, userId) => {
  try {
    const assessment = await prisma.assessments.findFirst({
      where: { id: Number(assessmentId), course: { userId } },
      include: {
        // `coreCourseId` feeds `enrichRowWithCourse`'s Core projection below.
        course: { select: { id: true, coreCourseId: true } },
        variants: {
          select: {
            id: true, questionText: true, difficulty: true, answer: true, choices: true,
            questionMetadataId: true, isAiGenerated: true, isDraft: true,
            questionMetadata: {
              select: {
                id: true, description: true, type: true, questionOrder: true,
                course: { select: { id: true } }
              }
            }
          }
        },
        sections: {
          include: {
            sectionVariants: {
              include: {
                variant: {
                  select: {
                    id: true, questionText: true, difficulty: true, reasoningLevel: true, answer: true, choices: true,
                    questionMetadataId: true, isAiGenerated: true, isDraft: true,
                    questionMetadata: {
                      select: {
                        id: true, description: true, type: true, questionOrder: true,
                        course: { select: { id: true } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    return withDerivedSemester(await enrichRowWithCourse(assessment));
  } catch (error) {
    throw error;
  }
};

/** Updates assessment metadata/blueprint while enforcing ownership and valid course references. */
export const updateAssessment = async (assessmentId, updateData, userId) => {
  try {
    const assessment = await prisma.assessments.findFirst({
      where: { id: Number(assessmentId), course: { userId } }
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    if (updateData.courseId) {
      const targetCourse = await prisma.course.findFirst({
        where: { id: Number(updateData.courseId), userId },
        select: { id: true }
      });

      if (!targetCourse) {
        throw new Error('Course not found');
      }
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
};

/**
 * Deletes an assessment. Linked variants are detached automatically —
 * `variants.assessment_id` has `onDelete: SetNull` — so no preliminary
 * update is needed.
 */
export const deleteAssessment = async (assessmentId, userId) => {
  try {
    const assessment = await prisma.assessments.findFirst({
      where: { id: Number(assessmentId), course: { userId } }
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    await prisma.assessments.delete({ where: { id: assessment.id } });
    return true;
  } catch (error) {
    throw error;
  }
};

/** Adds a question to an assessment by updating its per-assessment `questionOrder`. */
export const addQuestionToAssessment = async (assessmentId, questionId, orderNumber, userId) => {
  try {
    assessmentId = Number(assessmentId);
    // Verify user owns the question
    const question = await prisma.questionMetadata.findFirst({
      where: { id: Number(questionId), course: { userId } }
    });

    if (!question) {
      throw new Error('Question not found');
    }

    // Verify assessment exists and belongs to user
    const assessment = await prisma.assessments.findFirst({
      where: { id: assessmentId, course: { userId } }
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
    const currentOrder = question.questionOrder || {};
    currentOrder[assessmentId] = orderNumber;

    const updated = await prisma.questionMetadata.update({
      where: { id: question.id },
      data: { questionOrder: currentOrder }
    });

    return updated;
  } catch (error) {
    throw error;
  }
};

/** Removes a question from an assessment's ordering payload after verifying ownership. */
export const removeQuestionFromAssessment = async (assessmentId, questionId, userId) => {
  try {
    assessmentId = Number(assessmentId);
    // Verify user owns the question
    const question = await prisma.questionMetadata.findFirst({
      where: { id: Number(questionId), course: { userId } }
    });

    if (!question) {
      throw new Error('Question not found');
    }

    // Verify assessment belongs to the user
    const assessment = await prisma.assessments.findFirst({
      where: { id: assessmentId, course: { userId } }
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    // The question and assessment must live in the same course (#1).
    if (question.courseId !== assessment.courseId) {
      throw new Error('Question not found');
    }

    // Remove from question order
    const currentOrder = question.questionOrder || {};
    delete currentOrder[assessmentId];

    const updated = await prisma.questionMetadata.update({
      where: { id: question.id },
      data: { questionOrder: currentOrder }
    });

    return updated;
  } catch (error) {
    throw error;
  }
};

/** Returns questions scheduled for a given assessment ordered by their stored display order. */
export const getQuestionsInAssessment = async (assessmentId, userId) => {
  try {
    assessmentId = Number(assessmentId);
    // Verify assessment exists and belongs to user
    const assessment = await prisma.assessments.findFirst({
      where: { id: assessmentId, course: { userId } }
    });
    if (!assessment) {
      throw new Error('Assessment not found');
    }

    // `question_order` is a `json` column (not `jsonb`), so the `@>` containment
    // operator is unavailable. Use `->>` key extraction, which works on `json`
    // and mirrors the ORDER BY clause below. Both the key and the ownership
    // filter are bound as query parameters (Prisma's tagged-template
    // `$queryRaw`), not string-interpolated into the SQL.
    const assessmentKey = String(assessmentId);
    const orderedRows = await prisma.$queryRaw`
      SELECT qm.id
      FROM question_metadata qm
      JOIN courses c ON c.id = qm.course_id
      WHERE c.user_id = ${userId}
        AND qm.question_order ->> ${assessmentKey} IS NOT NULL
      ORDER BY CAST(qm.question_order ->> ${assessmentKey} AS INTEGER) ASC
    `;
    const orderedIds = orderedRows.map((row) => row.id);

    if (orderedIds.length === 0) {
      return [];
    }

    // Get all questions that have this assessment in their questionOrder
    const questions = await prisma.questionMetadata.findMany({
      where: { id: { in: orderedIds } },
      include: {
        // Ownership filter only — this endpoint returns rows unenriched, and
        // `Course` has no local name/code to select anymore (#1072 §4 step 10).
        course: { select: { id: true } },
        variants: {
          where: { assessmentId: Number(assessmentId) },
          select: { id: true, questionText: true, difficulty: true, answer: true, choices: true }
        }
      }
    });

    // `findMany({ where: { id: { in } } })` doesn't preserve `in`-list order —
    // re-sort to match the CAST(question_order->>...) ordering computed above.
    const byId = new Map(questions.map((q) => [q.id, q]));
    return orderedIds.map((id) => byId.get(id)).filter(Boolean);
  } catch (error) {
    throw error;
  }
};
