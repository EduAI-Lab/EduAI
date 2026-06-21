import { describe, expect, it } from 'vitest';
import { previewFromMessages } from '~/lib/student-chat-history';

describe('student-chat-history', () => {
  it('builds preview from the latest non-empty message', () => {
    expect(
      previewFromMessages([
        { id: '1', role: 'user', content: 'First' },
        { id: '2', role: 'assistant', content: '  Second reply  ' },
      ]),
    ).toBe('Second reply');
    expect(previewFromMessages([])).toBe('New conversation');
  });
});
