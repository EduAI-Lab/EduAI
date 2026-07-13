import { describe, expect, it } from "vitest";

import {
  classifyCloudStatus,
  resolveUbcBaseUrls,
} from "~/lib/ai/service-status.server";

describe("classifyCloudStatus", () => {
  it("is offline when no cloud key is present", () => {
    const s = classifyCloudStatus({});
    expect(s.state).toBe("offline");
    expect(s.detail).toMatch(/no cloud api key/i);
  });

  it("is online and names each configured provider", () => {
    const s = classifyCloudStatus({ openai: "sk-x", google: "  ", openrouter: "or-y" });
    expect(s.state).toBe("online");
    expect(s.detail).toContain("OpenAI");
    expect(s.detail).toContain("OpenRouter");
    // Whitespace-only keys are treated as absent.
    expect(s.detail).not.toContain("Google");
  });

  it("treats whitespace-only keys as absent", () => {
    expect(classifyCloudStatus({ openai: "   ", google: null }).state).toBe("offline");
  });
});

describe("resolveUbcBaseUrls", () => {
  it("reads and trims env base URLs", () => {
    const urls = resolveUbcBaseUrls({
      VLLM_BASE_URL: " http://cmps01:8001/v1 ",
      OLLAMA_BASE_URL: "http://localhost:11434/api",
    } as NodeJS.ProcessEnv);
    expect(urls.vllm).toBe("http://cmps01:8001/v1");
    expect(urls.ollama).toBe("http://localhost:11434/api");
  });

  it("returns undefined for unset / blank URLs", () => {
    const urls = resolveUbcBaseUrls({ VLLM_BASE_URL: "   " } as NodeJS.ProcessEnv);
    expect(urls.vllm).toBeUndefined();
    expect(urls.ollama).toBeUndefined();
  });
});
