/**
 * Validation helpers for the question_metadata.question_order JSON map.
 * Assessment IDs and display positions are persisted in JSON, so Prisma cannot
 * enforce their shape or course relationship at the database boundary.
 */

export const MAX_QUESTION_ORDER_NUMBER = Number.MAX_SAFE_INTEGER;

/** Returns a positive integer that is finite and exactly representable in JSON/JS. */
export const parsePositiveSafeInteger = (value) => {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_QUESTION_ORDER_NUMBER
    ? parsed
    : null;
};

/** Creates a stable public validation error for malformed question-order payloads. */
export const questionOrderValidationError = (message) => Object.assign(
  new Error(message),
  {
    status: 400,
    statusCode: 400,
    code: 'QM_QUESTION_ORDER_INVALID',
    isPublic: true,
  },
);

/** Parses a required positive-safe integer, retaining a normalized number for callers. */
export const requirePositiveSafeInteger = (value, label) => {
  const parsed = parsePositiveSafeInteger(value);
  if (parsed === null) {
    throw questionOrderValidationError(`${label} must be a positive safe integer`);
  }
  return parsed;
};

/**
 * Validates and normalizes an order map's local JSON shape. Course membership is
 * checked by the service after it has loaded the assessment rows.
 */
export const normalizeQuestionOrder = (questionOrder) => {
  if (questionOrder === undefined) return {};
  if (
    questionOrder === null ||
    typeof questionOrder !== 'object' ||
    Array.isArray(questionOrder)
  ) {
    throw questionOrderValidationError('questionOrder must be an object');
  }

  const normalized = {};
  for (const [rawAssessmentId, rawOrderNumber] of Object.entries(questionOrder)) {
    const assessmentId = parsePositiveSafeInteger(rawAssessmentId);
    if (assessmentId === null) {
      throw questionOrderValidationError('questionOrder assessment IDs must be positive safe integers');
    }

    const orderNumber = parsePositiveSafeInteger(rawOrderNumber);
    if (orderNumber === null) {
      throw questionOrderValidationError('questionOrder values must be positive safe integers');
    }

    normalized[String(assessmentId)] = orderNumber;
  }

  return normalized;
};
