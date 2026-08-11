// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createOpenAICompatibleMock, createOpenAIMock, createGoogleMock, createOllamaMock } =
  vi.hoisted(() => ({
    createOpenAICompatibleMock: vi.fn((_options: Record<string, unknown>) => vi.fn()),
    createOpenAIMock: vi.fn((_options: Record<string, unknown>) => vi.fn()),
    createGoogleMock: vi.fn((_options: Record<string, unknown>) => vi.fn()),
    createOllamaMock: vi.fn((_options: Record<string, unknown>) => vi.fn()),
  }));

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: (options: Record<string, unknown>) =>
    createOpenAICompatibleMock(options),
}));
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: (options: Record<string, unknown>) => createOpenAIMock(options),
}));
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: (options: Record<string, unknown>) => createGoogleMock(options),
}));
vi.mock('ollama-ai-provider', () => ({
  createOllama: (options: Record<string, unknown>) => createOllamaMock(options),
}));
vi.mock('ai', () => ({
  createProviderRegistry: (providers: unknown) => ({ __providers: providers }),
}));

import {
  createAIProviderRegistry,
  listEnabledRegistryProviders,
  OPENCODE_BASE_URL,
} from '~/lib/ai/providers';

describe('OpenCode provider registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('constructs the dedicated provider with the fixed endpoint and Bearer key source', () => {
    const registry = createAIProviderRegistry({
      opencode: {
        isEnabled: true,
        apiKey: 'opencode-secret',
        baseUrl: 'https://attacker.example.invalid/v1',
      },
    }) as unknown as { __providers: Record<string, unknown> };

    expect(createOpenAICompatibleMock).toHaveBeenCalledWith({
      name: 'opencode',
      baseURL: OPENCODE_BASE_URL,
      apiKey: 'opencode-secret',
    });
    expect(createOpenAICompatibleMock.mock.calls[0][0].baseURL).toBe(
      'https://opencode.ai/zen/go/v1',
    );
    expect(registry.__providers.opencode).toBeDefined();
    expect(listEnabledRegistryProviders({
      opencode: { isEnabled: true, apiKey: 'opencode-secret' },
    })).toEqual(['opencode']);
  });

  it('does not register OpenCode without an enabled key', () => {
    const registry = createAIProviderRegistry({
      opencode: { isEnabled: false, apiKey: 'opencode-secret' },
    }) as unknown as { __providers: Record<string, unknown> };
    expect(createOpenAICompatibleMock).not.toHaveBeenCalled();
    expect(registry.__providers.opencode).toBeUndefined();
    expect(listEnabledRegistryProviders({
      opencode: { isEnabled: false, apiKey: 'opencode-secret' },
    })).toEqual([]);
  });
});
