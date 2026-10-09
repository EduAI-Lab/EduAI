import { describe, it, expect } from "vitest";

import { buildToolCallingSystemPrompt } from "~/lib/ai/chat-tools";

describe("buildToolCallingSystemPrompt citations (#1936)", () => {
  const base = { basePrompt: "BASE", courseCode: "DATA 301", hasPreloadedRag: false };

  it("tells the model not to name course material titles", () => {
    const prompt = buildToolCallingSystemPrompt({ ...base, webToolsEnabled: false });
    expect(prompt).toContain("Do not cite course material titles");
    expect(prompt).not.toContain("Cite course material titles");
  });

  it("still asks for web URLs, as real text rather than a literal placeholder", () => {
    const prompt = buildToolCallingSystemPrompt({ ...base, webToolsEnabled: true });
    expect(prompt).toContain("Always cite URLs for web results.");
    expect(prompt).not.toContain("${");
  });
});
