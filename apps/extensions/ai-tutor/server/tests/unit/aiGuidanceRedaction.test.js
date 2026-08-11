import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    promptTemplate: {
      findUnique: vi.fn().mockResolvedValue({
        systemPrompt: 'Be a helpful tutor.',
      }),
    },
  },
}));

vi.mock('../../src/services/eduaiClient.js', () => ({
  getEduAiCompletionUrl: () => 'http://not-actually-called.test/api/completion',
}));

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function failedResponse(status, body, headers = {}) {
  return {
    ok: false,
    status,
    headers: new Headers(headers),
    text: () => Promise.resolve(body),
  };
}

function renderConsoleCalls(...spies) {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .flat()
    .map((value) => {
      if (value instanceof Error) {
        return `${value.name}: ${value.message}\n${value.stack || ''}`;
      }
      if (typeof value === 'string') return value;
      return JSON.stringify(value);
    })
    .join('\n');
}

async function generateGuideResponse() {
  const { generateGuideResponse: generate } = await import('../../src/services/aiGuidance.js');

  return generate({
    activity: {
      mainTopic: { name: 'Recursion' },
      config: {
        question: 'What is a recursive base case?',
        questionType: 'SHORT_TEXT',
      },
    },
    knowledgeLevel: 'beginner',
    message: 'Can you give me a hint?',
    studentAnswer: null,
    dualLoopEnabled: false,
    cookie: 'session=redaction-test',
    apiKey: 'fake-test-key',
  });
}

describe('AI guidance diagnostic redaction', () => {
  it('drops upstream response bodies from retry and terminal error logs', async () => {
    const canary = 'AUDIT_STUDENT_CONTENT_CANARY_7F3A';
    const upstreamBody = `${canary} retry-body cookie=session-secret provider_key=sk-secret`;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        failedResponse(503, upstreamBody, { 'X-Request-Id': 'request-retry-123' }),
      )
      .mockResolvedValueOnce(
        failedResponse(503, upstreamBody, {
          'X-Correlation-Id': 'correlation-terminal-456',
        }),
      );

    await expect(generateGuideResponse()).rejects.toMatchObject({ status: 503 });

    const consoleOutput = renderConsoleCalls(warnSpy, errorSpy);
    expect(consoleOutput).not.toContain(canary);
    expect(consoleOutput).not.toContain('session-secret');
    expect(consoleOutput).not.toContain('sk-secret');
    expect(warnSpy).toHaveBeenCalledWith(
      '[aiGuidance] upstream_retry',
      expect.objectContaining({
        status: 503,
        attempt: 1,
        requestId: 'request-retry-123',
      }),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      '[aiGuidance] upstream_http_error',
      expect.objectContaining({
        status: 503,
        attempt: 2,
        correlationId: 'correlation-terminal-456',
      }),
    );
  });

  it('drops unexpected response content while retaining safe response metadata', async () => {
    const canary = 'AUDIT_UNEXPECTED_RESPONSE_CANARY_91BC';
    const privateDiagnostic = `${canary} /internal/private/path?token=secret student-answer`;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'X-Request-Id': 'request-unexpected-789' }),
      json: () =>
        Promise.resolve({
          content: { privateDiagnostic },
          nested: { cookie: privateDiagnostic },
        }),
    });

    await expect(generateGuideResponse()).rejects.toThrow('Invalid response format from AI API');

    const consoleOutput = renderConsoleCalls(errorSpy);
    expect(consoleOutput).not.toContain(canary);
    expect(consoleOutput).not.toContain('/internal/private/path');
    expect(consoleOutput).not.toContain('student-answer');
    expect(errorSpy).toHaveBeenCalledWith(
      '[aiGuidance] unexpected_response_format',
      expect.objectContaining({
        status: 200,
        attempt: 1,
        requestId: 'request-unexpected-789',
        responseType: 'object',
        contentType: 'object',
      }),
    );
  });

  it('does not serialize thrown error messages or stack details into logs', async () => {
    const canary = 'AUDIT_THROWN_ERROR_CANARY_D024';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const upstreamError = new Error(
      `connect failed: ${canary} cookie=session-secret query=SELECT_private_data`,
    );
    upstreamError.stack = `Error: ${canary}\n    at /internal/private/provider.js:42:7`;
    upstreamError.status = 502;
    upstreamError.requestId = 'request-network-101';
    global.fetch = vi.fn().mockRejectedValue(upstreamError);

    await expect(generateGuideResponse()).rejects.toBe(upstreamError);

    const consoleOutput = renderConsoleCalls(errorSpy);
    expect(consoleOutput).not.toContain(canary);
    expect(consoleOutput).not.toContain('/internal/private/provider.js');
    expect(errorSpy).toHaveBeenCalledWith(
      '[aiGuidance] call_failed',
      expect.objectContaining({ status: 502, requestId: 'request-network-101' }),
    );
  });

  it('returns a fixed fallback instead of a synchronous internal error message', async () => {
    const canary = 'AUDIT_SYNC_GUIDANCE_ERROR_CANARY_F15B';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { prisma } = await import('../../src/config/database.js');
    prisma.promptTemplate.findUnique.mockRejectedValueOnce(
      new Error(`${canary} /srv/private/prisma/query-engine SELECT prompt_templates`),
    );

    const result = await generateGuideResponse();

    expect(result.message).toBe('AI study buddy not available right now. Please try again later.');
    expect(result.trace.finalResponse).toBe(result.message);
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(renderConsoleCalls(errorSpy)).not.toContain(canary);
  });
});
