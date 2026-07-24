import { describe, expect, it } from 'vitest';
import {
  campusProbeParams,
  pickCampusProbeFromCatalog,
  pickPreferredGenerationFromCatalog,
} from '../../src/services/modelCatalog.js';

describe('modelCatalog', () => {
  const catalog = [
    { provider: 'vllm', modelId: 'qwen2.5-32b-instruct', name: '32B', isActive: true },
    { provider: 'vllm', modelId: 'qwen2.5-7b-instruct', name: '7B', isActive: true },
    { provider: 'google', modelId: 'gemini-2.5-flash', name: 'Gemini', isActive: true },
  ];

  it('picks the smallest campus model for probes', () => {
    expect(pickCampusProbeFromCatalog(catalog)?.id).toBe('vllm:qwen2.5-7b-instruct');
  });

  it('picks the largest campus model for generation defaults', () => {
    expect(pickPreferredGenerationFromCatalog(catalog)?.id).toBe('vllm:qwen2.5-32b-instruct');
  });

  it('builds probe params from the catalog', () => {
    expect(campusProbeParams(catalog)).toEqual({
      provider: 'vllm',
      model: 'vllm:qwen2.5-7b-instruct',
      apiKeys: { vllm: { isEnabled: true } },
    });
  });
});
