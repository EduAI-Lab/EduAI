/**
 * Unit tests for the CORE_URL / EDUAI_BASE_URL consistency check (#225
 * edge-case audit SEAM-05).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  assertCoreUrlConsistency,
  __resetCoreUrlConsistencyWarningForTests,
} from '../../src/services/urlConsistency.js';

describe('assertCoreUrlConsistency', () => {
  let warnSpy;

  beforeEach(() => {
    __resetCoreUrlConsistencyWarningForTests();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('is consistent when CORE_URL and EDUAI_BASE_URL share an origin (EDUAI_BASE_URL carrying /api)', () => {
    const result = assertCoreUrlConsistency({
      CORE_URL: 'http://localhost:3000',
      EDUAI_BASE_URL: 'http://localhost:3000/api',
    });
    expect(result).toEqual({
      consistent: true,
      coreOrigin: 'http://localhost:3000',
      eduaiOrigin: 'http://localhost:3000',
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('is consistent when only one of the two vars is set', () => {
    expect(assertCoreUrlConsistency({ CORE_URL: 'http://localhost:3000' }).consistent).toBe(true);
    expect(assertCoreUrlConsistency({ EDUAI_BASE_URL: 'http://localhost:3000/api' }).consistent).toBe(true);
    expect(assertCoreUrlConsistency({}).consistent).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('is consistent when a var is present but unparsable as a URL (not this helper\'s job)', () => {
    const result = assertCoreUrlConsistency({
      CORE_URL: 'not-a-url',
      EDUAI_BASE_URL: 'http://localhost:3000/api',
    });
    expect(result.consistent).toBe(true);
    expect(result.coreOrigin).toBeNull();
  });

  it('detects a mismatch (different host) and warns once', () => {
    const env = { CORE_URL: 'http://localhost:3000', EDUAI_BASE_URL: 'http://other-host:5174/api' };

    const result = assertCoreUrlConsistency(env);

    expect(result.consistent).toBe(false);
    expect(result.coreOrigin).toBe('http://localhost:3000');
    expect(result.eduaiOrigin).toBe('http://other-host:5174');
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('CORE_URL');
    expect(warnSpy.mock.calls[0][0]).toContain('EDUAI_BASE_URL');
  });

  it('detects a mismatch on differing port for the same host', () => {
    const result = assertCoreUrlConsistency({
      CORE_URL: 'http://localhost:3000',
      EDUAI_BASE_URL: 'http://localhost:5174/api',
    });
    expect(result.consistent).toBe(false);
  });

  it('warns only once across repeated calls with a mismatch', () => {
    const env = { CORE_URL: 'http://a.test', EDUAI_BASE_URL: 'http://b.test/api' };
    assertCoreUrlConsistency(env);
    assertCoreUrlConsistency(env);
    assertCoreUrlConsistency(env);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('throws instead of warning when EDUAI_ENFORCE_URL_CONSISTENCY=1', () => {
    const env = {
      CORE_URL: 'http://a.test',
      EDUAI_BASE_URL: 'http://b.test/api',
      EDUAI_ENFORCE_URL_CONSISTENCY: '1',
    };
    expect(() => assertCoreUrlConsistency(env)).toThrow(/CORE_URL/);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not throw when EDUAI_ENFORCE_URL_CONSISTENCY is set to something other than "1"', () => {
    const env = {
      CORE_URL: 'http://a.test',
      EDUAI_BASE_URL: 'http://b.test/api',
      EDUAI_ENFORCE_URL_CONSISTENCY: 'true',
    };
    expect(() => assertCoreUrlConsistency(env)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledOnce();
  });
});
