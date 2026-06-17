import { describe, it, expect } from "vitest";
import {
  allowsSupportsToolsToggle,
  isSmallModelSlug,
} from "~/lib/ai/model-tool-capability";

describe("isSmallModelSlug", () => {
  it("detects common small Ollama slugs", () => {
    expect(isSmallModelSlug("qwen2.5:1.5b")).toBe(true);
    expect(isSmallModelSlug("gemma2:2b")).toBe(true);
    expect(isSmallModelSlug("phi3:mini")).toBe(true);
  });

  it("allows 7B+ models", () => {
    expect(isSmallModelSlug("qwen2.5:7b")).toBe(false);
    expect(isSmallModelSlug("llama3.1:8b")).toBe(false);
    expect(isSmallModelSlug("deepseek-r1:8b")).toBe(false);
  });
});

describe("allowsSupportsToolsToggle", () => {
  it("hides toggle for non-CHAT types", () => {
    expect(allowsSupportsToolsToggle("text-embedding-3-small", "EMBEDDING")).toBe(false);
  });

  it("shows toggle for small CHAT models", () => {
    expect(allowsSupportsToolsToggle("qwen2.5:1.5b", "CHAT")).toBe(true);
  });

  it("shows toggle for tool-capable CHAT models", () => {
    expect(allowsSupportsToolsToggle("qwen2.5:7b", "CHAT")).toBe(true);
    expect(allowsSupportsToolsToggle("gpt-4o", "CHAT")).toBe(true);
  });
});
