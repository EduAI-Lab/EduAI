import { describe, expect, it } from "vitest";
import { buildMcqSubmission } from "~/lib/activityForm";

/**
 * `buildMcqSubmission` is the compaction + remap that the edit path has always
 * done inside `buildUpdatePayload` and the add path never did. Both call it now,
 * so a two-option question authored in either form reaches students as two
 * options — and the answer key follows its choice to the new index.
 */
describe("buildMcqSubmission", () => {
  it("drops blank slots and remaps the answer key to its new index", () => {
    const result = buildMcqSubmission(["Paris", "", "Rome", ""], 2);

    expect(result.error).toBeUndefined();
    expect(result.options).toEqual(["Paris", "Rome"]);
    // "Rome" was authored at index 2 with a blank in front of it; after
    // compaction it sits at index 1 and the key must say so.
    expect(result.correctIndex).toBe(1);
  });

  it("trims surrounding whitespace before deciding a slot is blank", () => {
    const result = buildMcqSubmission(["  Paris  ", "   ", "Rome", ""], 0);

    expect(result.options).toEqual(["Paris", "Rome"]);
    expect(result.correctIndex).toBe(0);
  });

  it("refuses fewer than two surviving choices", () => {
    const result = buildMcqSubmission(["Paris", "", "", ""], 0);

    expect(result.error).toBe("Provide at least two answer choices.");
    expect(result.options).toBeUndefined();
  });

  it("refuses when the marked answer is itself a blank slot", () => {
    // Index 3 is empty, so after compaction it points at nothing. Silently
    // keying this to whatever survives at index 3 is the bug being fixed.
    const result = buildMcqSubmission(["Paris", "Rome", "Berlin", ""], 3);

    expect(result.error).toBe("Select a valid correct answer.");
    expect(result.options).toBeUndefined();
  });

  it("keeps every choice when none are blank", () => {
    const result = buildMcqSubmission(["A", "B", "C", "D"], 3);

    expect(result.options).toEqual(["A", "B", "C", "D"]);
    expect(result.correctIndex).toBe(3);
  });
});
