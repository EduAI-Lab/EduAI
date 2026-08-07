/**
 * Unit tests for normalizeCourseCode.
 */
import { describe, expect, it } from 'vitest';
import { normalizeCourseCode } from '../../src/services/courseCodeUtils.js';

describe('normalizeCourseCode', () => {
  it('lowercases and strips whitespace', () => {
    expect(normalizeCourseCode('COSC 121')).toBe('cosc121');
  });

  it('returns empty string for missing values', () => {
    expect(normalizeCourseCode(null)).toBe('');
    expect(normalizeCourseCode('')).toBe('');
  });
});
