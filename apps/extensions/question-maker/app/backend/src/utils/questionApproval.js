/**
 * Pure validation and normalization helpers for bulk question approval.
 */

/**
 * Resolve a course id from its canonical (`courseId`) and legacy (`classId`)
 * aliases. When both are present they must agree, otherwise the client could
 * smuggle a course override through the unused alias.
 */
function resolveCourseId(courseId, classId) {
  const hasCourseId = courseId !== undefined && courseId !== null;
  const hasClassId = classId !== undefined && classId !== null;

  if (hasCourseId && hasClassId && Number(courseId) !== Number(classId)) {
    return { conflicting: true };
  }

  return { conflicting: false, value: hasCourseId ? courseId : classId };
}

/** Validate the request shape and normalize its single top-level course target. */
export function parseApprovalTarget(body = {}) {
  const { questions, courseId, classId } = body;

  if (!Array.isArray(questions) || questions.length === 0) {
    return { error: 'Questions array is required' };
  }

  const resolved = resolveCourseId(courseId, classId);
  if (resolved.conflicting) {
    return { error: 'courseId and classId must match when both are provided' };
  }

  const targetCourseId = Number(resolved.value);
  if (!Number.isInteger(targetCourseId) || targetCourseId <= 0) {
    return { error: 'Valid courseId is required' };
  }

  return { questions, targetCourseId };
}

/**
 * Bind an approval batch to its authorized course and actual caller.
 * Course overrides are checked across the whole batch before topic normalization.
 */
export function prepareApprovalQuestions(
  questions,
  { targetCourseId, createdBy, normalizeTopicId },
) {
  for (const question of questions) {
    const resolved = resolveCourseId(question.courseId, question.classId);
    if (resolved.conflicting) {
      return {
        error: 'Each question courseId and classId must match when both are provided',
      };
    }

    if (resolved.value !== undefined) {
      const parsedCourseId = Number(resolved.value);
      if (
        !Number.isInteger(parsedCourseId) ||
        parsedCourseId <= 0 ||
        parsedCourseId !== targetCourseId
      ) {
        return {
          error: 'Each question courseId must match the authorized target course',
        };
      }
    }
  }

  const normalizedQuestions = questions.map((question) => {
    const description = question.description ?? question.content;
    return {
      description:
        typeof description === 'string' && description.trim()
          ? description.trim()
          : null,
      courseId: targetCourseId,
      primaryTopicId: normalizeTopicId(question.primaryTopicId),
      type: question.type,
      questionOrder: question.questionOrder,
      createdBy,
    };
  });

  if (normalizedQuestions.some((question) => !question.primaryTopicId)) {
    return { error: 'Each question must include a valid primaryTopicId' };
  }

  return { questions: normalizedQuestions };
}
