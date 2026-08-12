import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/settings.js', () => ({
  config: {
    qmAiRateLimitWindowMs: 60_000,
    qmAiRateLimitMax: 20,
    qmAiProviderCallLimit: 60,
    qmAiOperationDeadlineMs: 90_000,
    qmBankMaxQuestionIds: 10,
    qmBankMaxVariantsPerQuestion: 2,
    qmBankMaxProviderCalls: 24,
    qmReviewMaxPairs: 10,
    qmReviewMaxProviderCalls: 21,
    qmChatMaxMessages: 40,
    qmChatMaxMessageChars: 12_000,
    qmChatMaxAggregateChars: 80_000,
    qmTestApiKeyMaxBodyBytes: 8_192,
    qmTestApiKeyMaxProviderKeyChars: 512,
  },
}));

const {
  qmAiProviderCallAdmission,
  resetQmAiAdmissionForTests,
  validateBankVariantAdmission,
  validateChatAdmission,
  validateTestApiKeyAdmission,
} = await import('../../src/middleware/aiAdmission.js');

describe('Question Maker AI admission audit controls', () => {
  beforeEach(() => resetQmAiAdmissionForTests());

  it('rejects duplicate, non-finite, and over-budget bank question ids before the handler', () => {
    expect(validateBankVariantAdmission({ questionIds: [1, '1'] })).toMatchObject({
      code: 'QM_BANK_QUESTION_IDS_DUPLICATE',
    });
    expect(validateBankVariantAdmission({ questionIds: [1, 'nope'] })).toMatchObject({
      code: 'QM_BANK_QUESTION_ID_INVALID',
    });
    expect(validateBankVariantAdmission({ questionIds: Array.from({ length: 10 }, (_, i) => i + 1), variantsToAdd: 2 })).toMatchObject({
      questionIds: expect.any(Array),
    });
    expect(validateBankVariantAdmission({ questionIds: Array.from({ length: 10 }, (_, i) => i + 1), variantsToAdd: 2 })).toMatchObject({
      code: 'QM_BANK_PROVIDER_CALL_BUDGET',
    });
  });

  it('bounds chat messages and test-api-key provider probing', () => {
    expect(validateChatAdmission({ messages: [{ role: 'user', content: 'x'.repeat(12_001) }] })).toMatchObject({
      code: 'QM_CHAT_MESSAGE_TOO_LARGE',
    });
    expect(validateChatAdmission({ messages: Array.from({ length: 41 }, () => ({ role: 'user', content: 'x' })) })).toMatchObject({
      code: 'QM_CHAT_MESSAGE_COUNT_TOO_LARGE',
    });
    expect(validateTestApiKeyAdmission({ provider: 'google', apiKeys: { google: { apiKey: 'a' }, openai: { apiKey: 'b' } } })).toMatchObject({
      code: 'QM_TEST_API_KEY_AMBIGUOUS_PROVIDER',
    });
  });

  it('keys provider-call admission by authenticated user, not source IP', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: req.headers['x-user'] };
      next();
    });
    app.post('/ai', qmAiProviderCallAdmission({ getCost: () => 60 }), (_req, res) => {
      res.json({ ok: true });
    });

    const first = await request(app).post('/ai').set('x-user', 'alice');
    const blocked = await request(app).post('/ai').set('x-user', 'alice');
    const isolated = await request(app).post('/ai').set('x-user', 'bob');

    expect(first.status).toBe(200);
    expect(blocked.status).toBe(429);
    expect(isolated.status).toBe(200);
  });
});
