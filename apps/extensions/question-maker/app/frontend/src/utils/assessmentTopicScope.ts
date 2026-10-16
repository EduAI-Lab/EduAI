/**
 * Client-side view of assessment topic scope (#1974). Mirrors the backend rule in
 * `services/assessmentTopicScope.js`: an empty or missing `primaryTopicIds` list means
 * the assessment covers every topic. The backend is the guard; these helpers only keep
 * the UI from offering choices the server would refuse.
 */
import type { Assessment } from "../types/question";

type ScopedAssessment = Pick<Assessment, "blueprintConfig"> | null | undefined;

/** The assessment's chosen topic ids, or `[]` when it is unrestricted. */
export function getAssessmentTopicIds(assessment: ScopedAssessment): string[] {
  const raw = assessment?.blueprintConfig?.primaryTopicIds;
  return Array.isArray(raw) ? raw : [];
}

/** Whether a question with this primary topic may go into the assessment; no topic yet rules nothing out. */
export function assessmentCoversTopic(assessment: ScopedAssessment, topicId: string): boolean {
  const ids = getAssessmentTopicIds(assessment);
  return ids.length === 0 || !topicId || ids.includes(topicId);
}
