/**
 * Pure validation and normalization helpers for bulk question approval.
 */

/** Validate the request shape and normalize its single top-level course target. */
export function parseApprovalTarget(body = {}) {
  const { questions, courseId, classId } = body;

  if (!Array.isArray(questions) || questions.length === 0) {
    return { error: 'Questions array is required' };
  }

  const targetCourseId = Number(courseId ?? classId);
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
    const suppliedCourseId = question.courseId ?? question.classId;
    if (suppliedCourseId !== undefined) {
      const parsedCourseId = Number(suppliedCourseId);
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
