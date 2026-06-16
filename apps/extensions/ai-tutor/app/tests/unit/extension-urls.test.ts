import { describe, expect, it } from 'vitest';
import { getAiTutorAppUrl, getEduAiAppUrl } from '~/lib/extension-urls';

describe('extension-urls', () => {
  it('defaults EduAI Core URL for local dev', () => {
    expect(getEduAiAppUrl()).toMatch(/^http/);
  });

  it('defaults AiTutor URL for local dev', () => {
    expect(getAiTutorAppUrl()).toMatch(/^http/);
  });
});
