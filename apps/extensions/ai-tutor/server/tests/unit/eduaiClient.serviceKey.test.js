import { describe, it, expect } from 'vitest';
import {
  EDUAI_SERVICE_KEY_SETUP_MESSAGE,
  mapEduAiServiceKeyError,
} from '../../src/services/eduaiServiceKeyErrors.js';

describe('mapEduAiServiceKeyError', () => {
  it('maps missing local key configuration to 503 SERVICE_KEY_MISMATCH', () => {
    const error = new Error('EDUAI_API_KEY not configured');
    expect(mapEduAiServiceKeyError(error)).toEqual({
      status: 503,
      message: EDUAI_SERVICE_KEY_SETUP_MESSAGE,
      code: 'SERVICE_KEY_MISMATCH',
    });
  });

  it('maps Core INVALID_SERVICE_KEY 403 to 503 SERVICE_KEY_MISMATCH', () => {
    const error = Object.assign(new Error('{"error":"INVALID_SERVICE_KEY"}'), { status: 403 });
    expect(mapEduAiServiceKeyError(error)?.code).toBe('SERVICE_KEY_MISMATCH');
  });

  it('returns null for unrelated RBAC 403 failures', () => {
    const error = Object.assign(new Error('Not authorized for this course'), { status: 403 });
    expect(mapEduAiServiceKeyError(error)).toBeNull();
  });
});
