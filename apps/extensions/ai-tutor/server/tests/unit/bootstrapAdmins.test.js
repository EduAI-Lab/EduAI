import { describe, it, expect } from 'vitest';
import {
  normalizeEmail,
  getBootstrapAdminEmails,
  isBootstrapAdminEmail,
} from '../../src/config/bootstrapAdmins.js';

describe('normalizeEmail', () => {
  it('trims and lowercases a string email', () => {
    expect(normalizeEmail('  Abdallah.Mohamed@UBC.ca  ')).toBe('abdallah.mohamed@ubc.ca');
  });

  it('returns empty string for non-string input', () => {
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail(undefined)).toBe('');
    expect(normalizeEmail(42)).toBe('');
  });
});

describe('getBootstrapAdminEmails', () => {
  it('returns the fixed bootstrap admin list', () => {
    const emails = getBootstrapAdminEmails();
    expect(emails).toContain('abdallah.mohamed@ubc.ca');
    expect(emails).toContain('mostafa.mohamed@ubc.ca');
    expect(emails).toContain('stavan@student.ubc.ca');
    expect(emails).toHaveLength(3);
  });
});

describe('isBootstrapAdminEmail', () => {
  it('returns true for a known bootstrap admin regardless of case/whitespace', () => {
    expect(isBootstrapAdminEmail('  MOSTAFA.mohamed@ubc.ca ')).toBe(true);
  });

  it('returns false for an unknown email', () => {
    expect(isBootstrapAdminEmail('someone-else@ubc.ca')).toBe(false);
  });

  it('returns false for empty/non-string input', () => {
    expect(isBootstrapAdminEmail('')).toBe(false);
    expect(isBootstrapAdminEmail(null)).toBe(false);
    expect(isBootstrapAdminEmail(undefined)).toBe(false);
  });
});
