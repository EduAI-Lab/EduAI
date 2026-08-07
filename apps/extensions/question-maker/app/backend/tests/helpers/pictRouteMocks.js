import { vi } from 'vitest';

/**
 * Shared mock factories + session/enrollment stubs for the QM route-level
 * PICT world-builders (#1188): generate-questions and variant-lifecycle-put
 * both hit the real Express app via supertest with authService/settings/
 * coreApiService mocked and a stubbed `fetch`-based session.
 */

export function mockAuthService() {
  return { findOrCreateUser: vi.fn().mockResolvedValue({}) };
}

/** `overrides` merges into the base test config (e.g. `{ maxQuestions: 50 }`). */
export function mockSettings(overrides = {}) {
  const cfg = {
    coreUrl: 'http://core.test',
    eduaiApiKey: 'k',
    corsOrigins: ['*'],
    nodeEnv: 'test',
    logLevel: 'silent',
    ...overrides,
  };
  return { config: cfg, default: cfg };
}

/** `overrides` merges extra exports (e.g. `{ patchQuestionTestableOnCore: vi.fn() }`). */
export function mockCoreApiService(mockEnrollments, overrides = {}) {
  return {
    getCourseEnrollmentsFromCore: mockEnrollments,
    getCourseFromCore: vi.fn().mockResolvedValue({ id: 'cuid-core-course', department: 'COSC' }),
    getMyProfileFromCore: vi.fn().mockResolvedValue({ authorizedUnits: [] }),
    ...overrides,
  };
}

/** Stubs global fetch so authService's session lookup resolves to `user`. */
export function stubSessionUser(user) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ user }) }));
}

/** Sets the mocked Core enrollment for `userId`, or none if `role` is falsy. */
export function stubEnrollment(mockEnrollments, userId, role) {
  mockEnrollments.mockResolvedValue({
    enrollments: role ? [{ studentId: userId, role, isActive: true }] : [],
  });
}
