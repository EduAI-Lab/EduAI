import { AssessmentType } from "@eduai/question-maker-prisma-client";

const VALID_ASSESSMENT_TYPES = Object.values(AssessmentType);

export function assertAssessmentType(type) {
  if (!VALID_ASSESSMENT_TYPES.includes(type)) {
    throw Object.assign(
      new Error(`Invalid assessment type. Allowed values: ${VALID_ASSESSMENT_TYPES.join(", ")}`),
      { status: 400, code: "ASSESSMENT_TYPE_INVALID", isPublic: true },
    );
  }
}
