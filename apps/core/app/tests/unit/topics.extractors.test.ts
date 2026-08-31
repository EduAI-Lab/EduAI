import { describe, it, expect } from "vitest";

import { extractHeadingCandidates, MAX_HEADINGS_PER_MATERIAL } from "~/lib/topics/headings";
import { extractCanvasModuleCandidates, MAX_MODULE_TOPICS } from "~/lib/topics/canvas-modules";
import {
  buildTopicAnalysisPrompt,
  parseTopicAnalysisResponse,
  AI_EXCERPT_CHARS,
  AI_MAX_SAMPLED_MATERIALS,
  MAX_AI_TOPICS,
} from "~/lib/topics/ai";

describe("extractHeadingCandidates", () => {
  it("picks up labelled chapter/unit/week headings with their titles", () => {
    const text = [
      "Course pack",
      "Chapter 1: Introduction to Algorithms",
      "some body text that should not match",
      "Week 2 — Sorting",
      "Unit 3 Recursion",
    ].join("\n");

    expect(extractHeadingCandidates("m1", text).map((entry) => entry.name)).toEqual([
      "Chapter 1: Introduction to Algorithms".replace(":", " —"),
      "Week 2 — Sorting",
      "Unit 3 — Recursion",
    ]);
  });

  it("keeps a bare label with no title", () => {
    expect(extractHeadingCandidates("m1", "Chapter 7").map((entry) => entry.name)).toEqual([
      "Chapter 7",
    ]);
  });

  it("accepts roman numerals", () => {
    expect(extractHeadingCandidates("m1", "Part IV — Thermodynamics")[0].name).toBe(
      "Part IV — Thermodynamics",
    );
  });

  it("ignores a paragraph that merely starts with a label", () => {
    const paragraph = `Section 2 of the syllabus explains ${"detail ".repeat(30)}`;
    expect(extractHeadingCandidates("m1", paragraph)).toEqual([]);
  });

  it("ignores unlabelled lines so slide titles do not become topics", () => {
    expect(extractHeadingCandidates("m1", "Recursion\nBase Cases\nStack Frames")).toEqual([]);
  });

  it("attributes every candidate to the material it came from", () => {
    const [candidate] = extractHeadingCandidates("material-9", "Chapter 1 — Intro");
    expect(candidate.materialIds).toEqual(["material-9"]);
    expect(candidate.origin).toBe("MATERIAL_HEADING");
  });

  it("does not repeat a heading that appears on every page", () => {
    const repeated = Array.from({ length: 20 }, () => "Chapter 1 — Intro").join("\n");
    expect(extractHeadingCandidates("m1", repeated)).toHaveLength(1);
  });

  it("caps how many topics one badly-parsed file can produce", () => {
    const many = Array.from(
      { length: MAX_HEADINGS_PER_MATERIAL + 15 },
      (_, index) => `Chapter ${index + 1} — Topic ${index + 1}`,
    ).join("\n");
    expect(extractHeadingCandidates("m1", many)).toHaveLength(MAX_HEADINGS_PER_MATERIAL);
  });

  it("returns nothing for a material with no extracted text", () => {
    expect(extractHeadingCandidates("m1", null)).toEqual([]);
    expect(extractHeadingCandidates("m1", "")).toEqual([]);
  });
});

describe("extractCanvasModuleCandidates", () => {
  it("turns module names into the highest-confidence candidates", () => {
    const result = extractCanvasModuleCandidates(
      [
        { id: 1, name: "Week 1 — Limits" },
        { id: 2, name: "Week 2 — Derivatives" },
      ],
      new Map(),
    );

    expect(result.map((entry) => entry.name)).toEqual(["Week 1 — Limits", "Week 2 — Derivatives"]);
    expect(result.every((entry) => entry.origin === "CANVAS_MODULE")).toBe(true);
    expect(result.every((entry) => entry.confidence === 1)).toBe(true);
  });

  it("attributes a module's imported files as that topic's sources", () => {
    const result = extractCanvasModuleCandidates(
      [
        {
          id: 1,
          name: "Week 1 — Limits",
          items: [
            { id: 10, type: "File", content_id: 500 },
            { id: 11, type: "Page", content_id: 900 },
            { id: 12, type: "File", content_id: 501 },
          ],
        },
      ],
      new Map([
        ["500", "material-a"],
        ["501", "material-b"],
      ]),
    );

    expect(result[0].materialIds).toEqual(["material-a", "material-b"]);
  });

  it("still yields a topic for a module whose files were never imported", () => {
    const result = extractCanvasModuleCandidates(
      [{ id: 1, name: "Week 1 — Limits", items: [{ id: 10, type: "File", content_id: 500 }] }],
      new Map(),
    );

    expect(result[0].materialIds).toEqual([]);
  });

  it("skips Canvas's generic default module names", () => {
    const result = extractCanvasModuleCandidates(
      [
        { id: 1, name: "Course Content" },
        { id: 2, name: "Syllabus" },
        { id: 3, name: "Week 1 — Limits" },
      ],
      new Map(),
    );

    expect(result.map((entry) => entry.name)).toEqual(["Week 1 — Limits"]);
  });

  it("caps the number of module topics", () => {
    const modules = Array.from({ length: MAX_MODULE_TOPICS + 10 }, (_, index) => ({
      id: index,
      name: `Week ${index + 1} — Topic`,
    }));
    expect(extractCanvasModuleCandidates(modules, new Map())).toHaveLength(MAX_MODULE_TOPICS);
  });
});

describe("buildTopicAnalysisPrompt", () => {
  it("bounds both the number of materials and the text taken from each", () => {
    // Titles are deliberately not "Material N" — the prompt numbers its own
    // sections that way, and the two would be indistinguishable in the output.
    const materials = Array.from({ length: AI_MAX_SAMPLED_MATERIALS + 4 }, (_, index) => ({
      id: `m${index}`,
      title: `Doc-${index}`,
      rawText: "x".repeat(AI_EXCERPT_CHARS + 500),
    }));

    const prompt = buildTopicAnalysisPrompt(materials);

    expect(prompt).toContain(`Doc-${AI_MAX_SAMPLED_MATERIALS - 1}`);
    expect(prompt).not.toContain(`Doc-${AI_MAX_SAMPLED_MATERIALS}`);
    expect(prompt.length).toBeLessThan((AI_EXCERPT_CHARS + 200) * AI_MAX_SAMPLED_MATERIALS);
  });

  it("labels a material with no extracted text rather than omitting it", () => {
    const prompt = buildTopicAnalysisPrompt([{ id: "m1", title: "Scanned", rawText: null }]);
    expect(prompt).toContain("(no extracted text)");
  });
});

describe("parseTopicAnalysisResponse", () => {
  it("reads a well-formed topic list", () => {
    const result = parseTopicAnalysisResponse('{"topics":["Recursion","Sorting"]}', ["m1"]);

    expect(result.map((entry) => entry.name)).toEqual(["Recursion", "Sorting"]);
    expect(result.every((entry) => entry.origin === "AI")).toBe(true);
    expect(result[0].materialIds).toEqual(["m1"]);
  });

  it("tolerates the code fence models add anyway", () => {
    const fenced = '```json\n{"topics":["Recursion"]}\n```';
    expect(parseTopicAnalysisResponse(fenced, []).map((entry) => entry.name)).toEqual([
      "Recursion",
    ]);
  });

  it("treats unparseable output as no topics rather than an error", () => {
    expect(parseTopicAnalysisResponse("I'm sorry, I can't help with that.", [])).toEqual([]);
    expect(parseTopicAnalysisResponse('{"result": "nope"}', [])).toEqual([]);
  });

  it("discards non-string and unusable entries", () => {
    const result = parseTopicAnalysisResponse('{"topics":["Recursion",42,"","2026",null]}', []);
    expect(result.map((entry) => entry.name)).toEqual(["Recursion"]);
  });

  it("drops duplicates and caps the list", () => {
    const topics = [
      "Recursion",
      "recursion",
      ...Array.from({ length: 40 }, (_, i) => `Topic ${i}`),
    ];
    const result = parseTopicAnalysisResponse(JSON.stringify({ topics }), []);

    expect(result.length).toBeLessThanOrEqual(MAX_AI_TOPICS);
    // Case-only variants survive here (the shared deduper collapses them later),
    // so assert the cap rather than exact uniqueness.
    expect(result[0].name).toBe("Recursion");
  });
});
