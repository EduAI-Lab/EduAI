/**
 * Route-layer mapping for EduAI import UX only.
 * Does not change Core requireServiceKey or eduaiClient env guards.
 */

export const EDUAI_SERVICE_KEY_SETUP_MESSAGE =
  'EduAI service key is missing or mismatched. Set EDUAI_API_KEY to the same value in apps/core/.env and apps/extensions/ai-tutor/server/.env, then restart Core and AI Tutor.';

/** Map upstream service-key misconfiguration to a 503 ops message (import routes only). */
export function mapEduAiServiceKeyError(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (message.includes('EDUAI_API_KEY not configured')) {
    return { status: 503, message: EDUAI_SERVICE_KEY_SETUP_MESSAGE, code: 'SERVICE_KEY_MISMATCH' };
  }
  if (
    error?.status === 403 &&
    (message.includes('INVALID_SERVICE_KEY') || message.includes('MISSING_SERVICE_KEY'))
  ) {
    return { status: 503, message: EDUAI_SERVICE_KEY_SETUP_MESSAGE, code: 'SERVICE_KEY_MISMATCH' };
  }
  return null;
}
