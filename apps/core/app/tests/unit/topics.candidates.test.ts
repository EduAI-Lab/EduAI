import { describe, it, expect } from "vitest";

import {
  cleanTopicName,
  dedupeCandidates,
  isUsableTopicName,
  normalizeTopicName,
  rejectExistingCandidates,
  ORIGIN_CONFIDENCE,
  MAX_TOPIC_NAME_LENGTH,
  type TopicCandidate,
} from "~/lib/topics/candidates";

function candidate(overrides: Partial<TopicCandidate> = {}): TopicCandidate {
  return {
    name: "Chapter 3 — Recursion",
    origin: "MATERIAL_HEADING",
    confidence: ORIGIN_CONFIDENCE.MATERIAL_HEADING,
    materialIds: ["m1"],
    ...overrides,
  };
}

describe("normalizeTopicName", () => {
  it("treats case, punctuation, and whitespace runs as the same topic", () => {
    const forms = [
      "Chapter 3 - Recursion",
      "chapter 3: recursion",
      "Chapter  3   Recursion",
      "CHAPTER 3 — RECURSION!",
    ];
    const keys = new Set(forms.map(normalizeTopicName));
    expect([...keys]).toEqual(["chapter 3 recursion"]);
  });

  it("keeps different chapter numbers distinct", () => {
    expect(normalizeTopicName("Chapter 3")).not.toBe(normalizeTopicName("Chapter 4"));
  });

  it("preserves non-latin letters rather than stripping them", () => {
    expect(normalizeTopicName("Ünité 2 — Fonctions")).toBe("ünité 2 fonctions");
  });
});

describe("cleanTopicName", () => {
  it("collapses whitespace and trims trailing punctuation", () => {
    expect(cleanTopicName("  Week 2 :  Vectors ...  ")).toBe("Week 2 : Vectors");
  });

  it("leaves interior punctuation alone", () => {
    expect(cleanTopicName("Supply & Demand")).toBe("Supply & Demand");
  });
});

describe("isUsableTopicName", () => {
  it("rejects names with no letters", () => {
    expect(isUsableTopicName("2026")).toBe(false);
    expect(isUsableTopicName("3.")).toBe(false);
  });

  it("rejects names that are too short or too long", () => {
    expect(isUsableTopicName("AI")).toBe(false);
    expect(isUsableTopicName("a".repeat(MAX_TOPIC_NAME_LENGTH + 1))).toBe(false);
  });

  it("accepts an ordinary chapter title", () => {
    expect(isUsableTopicName("Chapter 3 — Recursion")).toBe(true);
  });
});

describe("dedupeCandidates", () => {
  it("keeps the higher-confidence spelling and unions source materials", () => {
    const result = dedupeCandidates([
      candidate({ name: "chapter 3 recursion", materialIds: ["m1"] }),
      candidate({
        name: "Chapter 3 — Recursion",
        origin: "CANVAS_MODULE",
        confidence: ORIGIN_CONFIDENCE.CANVAS_MODULE,
        materialIds: ["m2"],
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Chapter 3 — Recursion");
    expect(result[0].origin).toBe("CANVAS_MODULE");
    expect(result[0].materialIds.sort()).toEqual(["m1", "m2"]);
  });

  it("keeps the first-seen spelling on a confidence tie", () => {
    const result = dedupeCandidates([
      candidate({ name: "Week 1 — Intro" }),
      candidate({ name: "week 1 intro" }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Week 1 — Intro");
  });

  it("does not repeat a material id that arrived twice", () => {
    const result = dedupeCandidates([
      candidate({ materialIds: ["m1", "m1"] }),
      candidate({ materialIds: ["m1"] }),
    ]);

    expect(result[0].materialIds).toEqual(["m1"]);
  });
});

describe("rejectExistingCandidates", () => {
  it("drops a candidate the course already has under different punctuation", () => {
    const result = rejectExistingCandidates(
      [candidate({ name: "Chapter 3 — Recursion" }), candidate({ name: "Chapter 4 — Trees" })],
      ["chapter 3: recursion"],
    );

    expect(result.map((entry) => entry.name)).toEqual(["Chapter 4 — Trees"]);
  });

  it("keeps a dismissal permanent when soft-deleted names are supplied", () => {
    // The caller passes soft-deleted topics too, which is what stops a dismissed
    // suggestion being recreated on the next resync.
    const result = rejectExistingCandidates(
      [candidate({ name: "Chapter 3 — Recursion" })],
      ["Chapter 3 — Recursion"],
    );

    expect(result).toEqual([]);
  });

  it("returns every candidate when the course has no topics", () => {
    const candidates = [candidate({ name: "Chapter 1 — Intro" })];
    expect(rejectExistingCandidates(candidates, [])).toEqual(candidates);
  });
});
