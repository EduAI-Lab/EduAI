import { describe, expect, it } from 'vitest';
import {
  campusProbeParams,
  pickCampusProbeFromCatalog,
  pickPreferredGenerationFromCatalog,
} from '../../src/services/modelCatalog.js';

describe('modelCatalog', () => {
  const catalog = [
    { provider: 'vllm', modelId: 'qwen3.5-27b', name: '27B', isActive: true },
    { provider: 'vllm', modelId: 'qwen3.5-9b', name: '9B', isActive: true },
    { provider: 'vllm', modelId: 'qwen3.5-4b', name: '4B', isActive: true },
    { provider: 'vllm', modelId: 'qwen3.5-2b', name: '2B', isActive: true },
    { provider: 'google', modelId: 'gemini-2.5-flash', name: 'Gemini', isActive: true },
  ];

  it('picks the smallest campus model for probes', () => {
    expect(pickCampusProbeFromCatalog(catalog)?.id).toBe('vllm:qwen3.5-2b');
  });

  it('picks the largest campus model for generation defaults', () => {
    expect(pickPreferredGenerationFromCatalog(catalog)?.id).toBe('vllm:qwen3.5-27b');
  });

  it('builds probe params from the catalog', () => {
    expect(campusProbeParams(catalog)).toEqual({
      provider: 'vllm',
      model: 'vllm:qwen3.5-2b',
      apiKeys: { vllm: { isEnabled: true } },
    });
  });
});
