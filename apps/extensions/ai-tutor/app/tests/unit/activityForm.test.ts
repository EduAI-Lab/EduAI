import { describe, expect, it } from "vitest";
import {
  activityToFormValues,
  buildUpdatePayload,
  ensureChoiceSlots,
  hintsToTextarea,
  parseHintsInput,
  type ActivityFormValues,
} from "~/lib/activityForm";
import type { Activity } from "~/lib/types";

function baseActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 1,
    title: null,
    instructionsMd: "",
    position: 0,
    question: "What is 2+2?",
    type: "MCQ",
    options: { choices: ["3", "4"] },
    answer: { correctIndex: 1 },
    hints: [],
    mainTopic: null,
    secondaryTopics: [],
    enableTeachMode: true,
    enableGuideMode: true,
    enableCustomMode: false,
    customPrompt: null,
    customPromptTitle: null,
    ...overrides,
  };
}

describe("ensureChoiceSlots", () => {
  it("pads choices to the minimum of 4 by default", () => {
    expect(ensureChoiceSlots(["a", "b"])).toEqual(["a", "b", "", ""]);
  });

  it("does not truncate when already at or above the minimum", () => {
    expect(ensureChoiceSlots(["a", "b", "c", "d", "e"])).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("respects a custom minimum", () => {
    expect(ensureChoiceSlots(["a"], 2)).toEqual(["a", ""]);
  });
});

describe("hintsToTextarea", () => {
  it("joins hints with newlines", () => {
    expect(hintsToTextarea(["first", "second"])).toBe("first\nsecond");
  });

  it("returns empty string for empty/non-array input", () => {
    expect(hintsToTextarea([])).toBe("");
    expect(hintsToTextarea(undefined as unknown as string[])).toBe("");
  });
});

describe("parseHintsInput", () => {
  it("splits on newlines, trims, and drops blanks", () => {
    expect(parseHintsInput("one\n  two  \n\nthree\n")).toEqual(["one", "two", "three"]);
  });

  it("returns an empty array for blank input", () => {
    expect(parseHintsInput("   \n  ")).toEqual([]);
  });
});

describe("activityToFormValues", () => {
  it("converts an MCQ activity into form values", () => {
    const activity = baseActivity({ hints: ["h1", "h2"] });
    const values = activityToFormValues(activity);

    expect(values.type).toBe("MCQ");
    expect(values.question).toBe("What is 2+2?");
    expect(values.choices).toEqual(["3", "4", "", ""]);
    expect(values.correctIndex).toBe(1);
    expect(values.hintsText).toBe("h1\nh2");
    expect(values.textAnswer).toBe("");
  });

  it("converts a SHORT_TEXT activity into form values", () => {
    const activity = baseActivity({
      type: "SHORT_TEXT",
      options: null,
      answer: { text: "Paris" },
    });
    const values = activityToFormValues(activity);

    expect(values.type).toBe("SHORT_TEXT");
    expect(values.textAnswer).toBe("Paris");
    expect(values.correctIndex).toBe(0);
  });

  it("defaults correctIndex to 0 when out of range", () => {
    const activity = baseActivity({ answer: { correctIndex: 99 } });
    const values = activityToFormValues(activity);
    expect(values.correctIndex).toBe(0);
  });

  it("falls back to empty strings for missing optional fields", () => {
    const activity = baseActivity({ title: null, instructionsMd: null as unknown as string });
    const values = activityToFormValues(activity);
    expect(values.title).toBe("");
    expect(values.instructionsMd).toBe("");
  });
});

describe("buildUpdatePayload", () => {
  function mcqValues(overrides: Partial<ActivityFormValues> = {}): ActivityFormValues {
    return {
      title: "",
      instructionsMd: "",
      question: "Pick one",
      type: "MCQ",
      choices: ["A", "B", "", ""],
      correctIndex: 1,
      textAnswer: "",
      hintsText: "",
      ...overrides,
    };
  }

  it("requires a non-empty question", () => {
    const { error, payload } = buildUpdatePayload(mcqValues({ question: "   " }));
    expect(error).toBe("Question is required.");
    expect(payload).toBeUndefined();
  });

  it("builds an MCQ payload, stripping blank choices", () => {
    const { payload, error } = buildUpdatePayload(mcqValues());
    expect(error).toBeUndefined();
    expect(payload).toEqual({
      title: null,
      instructionsMd: "",
      question: "Pick one",
      type: "MCQ",
      options: ["A", "B"],
      answer: { correctIndex: 1 },
      hints: [],
    });
  });

  it("remaps correctIndex when earlier blank choices are stripped", () => {
    // Choices: ['', 'A', '', 'B'], correctIndex points at 'B' (index 3).
    // After stripping blanks -> ['A', 'B'], so B's new index is 1.
    const { payload } = buildUpdatePayload(
      mcqValues({ choices: ["", "A", "", "B"], correctIndex: 3 }),
    );
    expect(payload?.options).toEqual(["A", "B"]);
    expect(payload?.answer).toEqual({ correctIndex: 1 });
  });

  it("requires at least two non-blank choices", () => {
    const { error, payload } = buildUpdatePayload(
      mcqValues({ choices: ["A", "", "", ""], correctIndex: 0 }),
    );
    expect(error).toBe("Provide at least two answer choices.");
    expect(payload).toBeUndefined();
  });

  it("requires the correct answer to point at a surviving choice", () => {
    // correctIndex points at a blank slot that gets stripped out.
    const { error, payload } = buildUpdatePayload(
      mcqValues({ choices: ["A", "B", "", ""], correctIndex: 2 }),
    );
    expect(error).toBe("Select a valid correct answer.");
    expect(payload).toBeUndefined();
  });

  it("trims the optional title, dropping it to null when blank", () => {
    const { payload } = buildUpdatePayload(mcqValues({ title: "  My title  " }));
    expect(payload?.title).toBe("My title");

    const { payload: payload2 } = buildUpdatePayload(mcqValues({ title: "   " }));
    expect(payload2?.title).toBeNull();
  });

  it("builds a SHORT_TEXT payload", () => {
    const { payload, error } = buildUpdatePayload(
      mcqValues({ type: "SHORT_TEXT", textAnswer: "  Paris  ", question: "Capital?" }),
    );
    expect(error).toBeUndefined();
    expect(payload).toEqual({
      title: null,
      instructionsMd: "",
      question: "Capital?",
      type: "SHORT_TEXT",
      options: null,
      answer: { text: "Paris" },
      hints: [],
    });
  });

  it("requires a non-blank SHORT_TEXT answer", () => {
    const { error, payload } = buildUpdatePayload(
      mcqValues({ type: "SHORT_TEXT", textAnswer: "   " }),
    );
    expect(error).toBe("Provide the expected answer.");
    expect(payload).toBeUndefined();
  });

  it("parses hints from the hints textarea", () => {
    const { payload } = buildUpdatePayload(mcqValues({ hintsText: "h1\n\nh2" }));
    expect(payload?.hints).toEqual(["h1", "h2"]);
  });
});
