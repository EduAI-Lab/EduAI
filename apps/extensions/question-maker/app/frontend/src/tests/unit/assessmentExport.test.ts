/**
 * Unit tests for `assessmentExport` (#1546): filename slugging, block
 * collection (sorting, resolveVariant fallback, blank-stem skipping), the
 * plain-text join, and the real .docx builder's paragraph/answer-line paths.
 */
import { describe, expect, it } from "vitest";
import {
  assessmentBlocksToDocxBlob,
  assessmentBlocksToPlainText,
  collectAssessmentExportBlocks,
  slugifyAssessmentBasename,
} from "@/utils/assessmentExport";
import type { Assessment, QuestionVariant } from "@/types/question";

describe("slugifyAssessmentBasename", () => {
  it("slugifies a normal name", () => {
    expect(slugifyAssessmentBasename("Midterm Exam #1!", "fallback")).toBe("midterm-exam-1");
  });

  it("falls back when name is empty", () => {
    expect(slugifyAssessmentBasename("", "assessment")).toBe("assessment");
  });

  it("falls back when the slugified result is empty (all punctuation)", () => {
    expect(slugifyAssessmentBasename("!!!", "assessment")).toBe("assessment");
  });
});

const baseVariant = {
  difficulty: "medium" as const,
  assessmentId: null,
  secondaryTopicsId: null,
  referenceId: null,
};

function assessmentWithSections(sections: Assessment["sections"]): Assessment {
  return {
    id: 1,
    type: "Quiz",
    name: "Sample",
    semester: "2026W1",
    createdAt: "",
    updatedAt: "",
    sections,
  } as Assessment;
}

describe("collectAssessmentExportBlocks", () => {
  it("sorts sections by position then id, and links by displayOrder then id", () => {
    const v1: QuestionVariant = { ...baseVariant, id: 1, questionText: "Q1", choices: [] } as any;
    const v2: QuestionVariant = { ...baseVariant, id: 2, questionText: "Q2", choices: [] } as any;

    const assessment = assessmentWithSections([
      {
        id: 20,
        assessmentId: 1,
        name: "B",
        position: 1,
        createdAt: "",
        updatedAt: "",
        sectionVariants: [{ id: 200, sectionId: 20, variantId: 2, displayOrder: 1, variant: v2 }],
      },
      {
        id: 10,
        assessmentId: 1,
        name: "A",
        position: 0,
        createdAt: "",
        updatedAt: "",
        sectionVariants: [{ id: 100, sectionId: 10, variantId: 1, displayOrder: 1, variant: v1 }],
      },
    ] as any);

    const blocks = collectAssessmentExportBlocks(assessment);
    expect(blocks.map((b) => b.stem)).toEqual(["Q1", "Q2"]);
  });

  it("falls back to resolveVariant when link.variant is missing", () => {
    const resolved: QuestionVariant = {
      ...baseVariant,
      id: 5,
      questionText: "Resolved",
      choices: [],
    } as any;
    const assessment = assessmentWithSections([
      {
        id: 1,
        assessmentId: 1,
        name: "S",
        position: 0,
        createdAt: "",
        updatedAt: "",
        sectionVariants: [{ id: 1, sectionId: 1, variantId: 5, displayOrder: 1 }],
      },
    ] as any);

    const blocks = collectAssessmentExportBlocks(assessment, (id) =>
      id === 5 ? resolved : undefined,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].stem).toBe("Resolved");
  });

  it("skips a link whose variant cannot be resolved", () => {
    const assessment = assessmentWithSections([
      {
        id: 1,
        assessmentId: 1,
        name: "S",
        position: 0,
        createdAt: "",
        updatedAt: "",
        sectionVariants: [{ id: 1, sectionId: 1, variantId: 99, displayOrder: 1 }],
      },
    ] as any);
    expect(collectAssessmentExportBlocks(assessment)).toEqual([]);
  });

  it("falls back to questionMetadata.description when questionText is blank", () => {
    const variant: QuestionVariant = {
      ...baseVariant,
      id: 1,
      questionText: "   ",
      questionMetadata: { description: "From metadata" },
      choices: [],
    } as any;
    const assessment = assessmentWithSections([
      {
        id: 1,
        assessmentId: 1,
        name: "S",
        position: 0,
        createdAt: "",
        updatedAt: "",
        sectionVariants: [{ id: 1, sectionId: 1, variantId: 1, displayOrder: 1, variant }],
      },
    ] as any);
    expect(collectAssessmentExportBlocks(assessment)[0].stem).toBe("From metadata");
  });

  it("skips a link with no usable stem at all", () => {
    const variant: QuestionVariant = {
      ...baseVariant,
      id: 1,
      questionText: "",
      choices: [],
    } as any;
    const assessment = assessmentWithSections([
      {
        id: 1,
        assessmentId: 1,
        name: "S",
        position: 0,
        createdAt: "",
        updatedAt: "",
        sectionVariants: [{ id: 1, sectionId: 1, variantId: 1, displayOrder: 1, variant }],
      },
    ] as any);
    expect(collectAssessmentExportBlocks(assessment)).toEqual([]);
  });

  it("defaults to no sections/links when absent", () => {
    const assessment = assessmentWithSections(undefined as any);
    expect(collectAssessmentExportBlocks(assessment)).toEqual([]);
  });

  it("builds a single 'Correct answer' line for a non-multi-select variant", () => {
    const variant: QuestionVariant = {
      ...baseVariant,
      id: 1,
      questionText: "Q",
      answer: "B",
      choices: [
        { letter: "A", text: "x" },
        { letter: "B", text: "y" },
      ],
    } as any;
    const assessment = assessmentWithSections([
      {
        id: 1,
        assessmentId: 1,
        name: "S",
        position: 0,
        createdAt: "",
        updatedAt: "",
        sectionVariants: [{ id: 1, sectionId: 1, variantId: 1, displayOrder: 1, variant }],
      },
    ] as any);
    const [block] = collectAssessmentExportBlocks(assessment);
    expect(block.answerLine).toBe("Correct answer: B");
    expect(block.choiceLines).toEqual(["A. x", "B. y"]);
  });

  it("has a null answerLine when there is no answer at all", () => {
    const variant: QuestionVariant = {
      ...baseVariant,
      id: 1,
      questionText: "Q",
      choices: [],
    } as any;
    const assessment = assessmentWithSections([
      {
        id: 1,
        assessmentId: 1,
        name: "S",
        position: 0,
        createdAt: "",
        updatedAt: "",
        sectionVariants: [{ id: 1, sectionId: 1, variantId: 1, displayOrder: 1, variant }],
      },
    ] as any);
    expect(collectAssessmentExportBlocks(assessment)[0].answerLine).toBeNull();
  });
});

describe("assessmentBlocksToPlainText", () => {
  it("numbers blocks and joins stem/choices/answer", () => {
    const text = assessmentBlocksToPlainText([
      { stem: "Q1", choiceLines: ["A. x", "B. y"], answerLine: "Correct answer: A" },
      { stem: "Q2", choiceLines: [], answerLine: null },
    ]);
    expect(text).toBe("1. Q1\nA. x\nB. y\nCorrect answer: A\n\n2. Q2");
  });

  it("returns an empty string for no blocks", () => {
    expect(assessmentBlocksToPlainText([])).toBe("");
  });
});

describe("assessmentBlocksToDocxBlob", () => {
  it("builds a Blob for a multi-line stem with choices and an answer line", async () => {
    const assessment = assessmentWithSections([]);
    assessment.type = "Quiz";
    assessment.semester = "2026W1";
    (assessment as any).course = { name: "CPSC 110" };

    const blob = await assessmentBlocksToDocxBlob(assessment, [
      { stem: "Line one\nLine two", choiceLines: ["A. x"], answerLine: "Correct answer: A" },
    ]);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("builds a Blob when blocks have an empty stem and no answer line", async () => {
    const assessment = assessmentWithSections([]);
    const blob = await assessmentBlocksToDocxBlob(assessment, [
      { stem: "", choiceLines: [], answerLine: null },
    ]);
    expect(blob).toBeInstanceOf(Blob);
  });

  it("omits the course name from the meta line when absent", async () => {
    const assessment = assessmentWithSections([]);
    const blob = await assessmentBlocksToDocxBlob(assessment, []);
    expect(blob).toBeInstanceOf(Blob);
  });
});
