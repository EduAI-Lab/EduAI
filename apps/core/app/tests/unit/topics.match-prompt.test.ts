import { describe, it, expect } from "vitest";

import {
  buildTopicMatchPrompt,
  MATCH_EXCERPT_CHARS,
  MAX_PROMPT_TOPICS,
  parseTopicMatchResponse,
  TOPIC_MATCH_SYSTEM_PROMPT,
} from "~/lib/topics/match-prompt";

describe("buildTopicMatchPrompt (#1965)", () => {
  it("lists the topics by name and shows the material", () => {
    const prompt = buildTopicMatchPrompt({
      topics: ["Recursion", "Sorting"],
      material: { title: "Week 3", rawText: "quicksort" },
    });

    expect(prompt).toContain("- Recursion\n- Sorting");
    expect(prompt).toContain("## Material: Week 3");
    expect(prompt).toContain("quicksort");
  });

  it("bounds the excerpt and the topic list", () => {
    const topics = Array.from({ length: MAX_PROMPT_TOPICS + 5 }, (_, i) => `Topic ${i}`);
    const prompt = buildTopicMatchPrompt({
      topics,
      material: { title: "Long", rawText: "x".repeat(MATCH_EXCERPT_CHARS + 50) },
    });

    expect(prompt).toContain(`Topic ${MAX_PROMPT_TOPICS - 1}`);
    expect(prompt).not.toContain(`Topic ${MAX_PROMPT_TOPICS}\n`);
    expect(prompt).toContain("x".repeat(MATCH_EXCERPT_CHARS));
    expect(prompt).not.toContain("x".repeat(MATCH_EXCERPT_CHARS + 1));
  });

  it("falls back to the title when there is no text", () => {
    expect(
      buildTopicMatchPrompt({ topics: ["A"], material: { title: "Slides", rawText: null } }),
    ).toContain("(no extracted text; use the title)");
  });

  it("tells the model it may only choose from the list", () => {
    expect(TOPIC_MATCH_SYSTEM_PROMPT).toContain("Never invent a new topic");
  });
});

describe("parseTopicMatchResponse (#1965)", () => {
  it("reads a chosen topic", () => {
    expect(parseTopicMatchResponse('{"match": " Sorting "}')).toEqual({
      kind: "match",
      name: "Sorting",
    });
  });

  it("reads an explicit none", () => {
    expect(parseTopicMatchResponse('{"match": null}')).toEqual({ kind: "none" });
  });

  it("strips a code fence", () => {
    expect(parseTopicMatchResponse('```json\n{"match": "Graphs"}\n```')).toEqual({
      kind: "match",
      name: "Graphs",
    });
  });

  it("returns null for anything else", () => {
    expect(parseTopicMatchResponse("Sorting")).toBeNull();
    expect(parseTopicMatchResponse('{"topic": "Sorting"}')).toBeNull();
    expect(parseTopicMatchResponse('{"match": ""}')).toBeNull();
    expect(parseTopicMatchResponse('{"match": 3}')).toBeNull();
  });
});
