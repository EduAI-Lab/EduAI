import { describe, it, expect } from "vitest";

import {
  buildTopicSuggestPrompt,
  MAX_SUGGESTIONS_PER_RUN,
  MAX_SUMMARY_CHARS,
  parseTopicSuggestResponse,
  summarizeMaterial,
  TOPIC_SUGGEST_SYSTEM_PROMPT,
} from "~/lib/topics/suggest-prompt";

const base = { canvasModules: [], headings: [], excerpt: null, topics: [] };

describe("summarizeMaterial (#1966)", () => {
  it("describes a file by its module, headings and topics", () => {
    expect(
      summarizeMaterial({
        title: "Week 2",
        canvasModules: ["Module 2"],
        headings: ["Chapter 2 — Loops", "Chapter 3 — Arrays"],
        excerpt: null,
        topics: ["Loops"],
      }),
    ).toBe(
      "Week 2 | module: Module 2 | headings: Chapter 2 — Loops; Chapter 3 — Arrays | topics: Loops",
    );
  });

  it("uses a short excerpt only when there are no headings", () => {
    const line = summarizeMaterial({
      ...base,
      title: "Slides",
      excerpt: "  Hash   maps store pairs ",
    });
    expect(line).toBe("Slides | starts: Hash maps store pairs | no topic yet");
  });

  it("keeps at most five headings and bounds the line", () => {
    const headings = Array.from({ length: 8 }, (_, i) => `Heading ${i} ${"x".repeat(80)}`);
    const line = summarizeMaterial({ ...base, title: "Big", headings });
    expect(line).not.toContain("Heading 5");
    expect(line.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
  });
});

describe("buildTopicSuggestPrompt (#1966)", () => {
  it("lists every kind of topic and numbers the files from 1", () => {
    const prompt = buildTopicSuggestPrompt({
      accepted: ["Loops"],
      pending: ["Arrays"],
      dismissed: ["Pointers"],
      materials: ["Week 1 | no topic yet", "Week 2 | topics: Loops"],
    });
    expect(prompt).toContain("## Existing topics\n\n- Loops");
    expect(prompt).toContain("## Suggestions awaiting review\n\n- Arrays");
    expect(prompt).toContain("## Dismissed topics (never propose these again)\n\n- Pointers");
    expect(prompt).toContain("1. Week 1 | no topic yet\n2. Week 2 | topics: Loops");
  });

  it("marks an empty list rather than leaving a bare heading", () => {
    expect(
      buildTopicSuggestPrompt({ accepted: [], pending: [], dismissed: [], materials: ["a"] }),
    ).toContain("## Existing topics\n\n(none)");
  });

  it("tells the model to propose only what is missing", () => {
    expect(TOPIC_SUGGEST_SYSTEM_PROMPT).toContain("Never propose a dismissed topic again.");
  });
});

describe("parseTopicSuggestResponse (#1966)", () => {
  it("maps file numbers to 0-based indexes and drops ones out of range", () => {
    const content = JSON.stringify({
      topics: [{ name: "Recursion", files: [1, 3, 3, 9, 0, 1.5, "2"] }],
    });
    expect(parseTopicSuggestResponse(content, 3)).toEqual([{ name: "Recursion", files: [0, 2] }]);
  });

  it("drops a topic with no usable name or no real file", () => {
    const content = JSON.stringify({
      topics: [
        { name: "  ", files: [1] },
        { name: "Graphs", files: [] },
        { name: "Trees", files: [7] },
        { name: "Sorting", files: [2] },
      ],
    });
    expect(parseTopicSuggestResponse(content, 2)).toEqual([{ name: "Sorting", files: [1] }]);
  });

  it("strips a code fence and caps the number of proposals", () => {
    const topics = Array.from({ length: MAX_SUGGESTIONS_PER_RUN + 3 }, (_, i) => ({
      name: `Topic ${i}`,
      files: [1],
    }));
    const content = "```json\n" + JSON.stringify({ topics }) + "\n```";
    expect(parseTopicSuggestResponse(content, 1)).toHaveLength(MAX_SUGGESTIONS_PER_RUN);
  });

  it("returns nothing for a reply of the wrong shape", () => {
    expect(parseTopicSuggestResponse("Recursion, Graphs", 2)).toEqual([]);
    expect(parseTopicSuggestResponse('{"topics": "Recursion"}', 2)).toEqual([]);
  });
});
