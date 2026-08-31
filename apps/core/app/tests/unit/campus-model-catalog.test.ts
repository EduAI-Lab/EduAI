import { describe, expect, it } from "vitest";
import {
  CAMPUS_INTERACTIVE_MODEL_IDS,
  LEGACY_CAMPUS_MODEL_IDS,
  RETAINED_ASSIST_MODEL_ID,
} from "~/lib/ai/campus-model-catalog";

describe("campus model catalog contract", () => {
  it("keeps a clean interactive catalog while isolating the retained Assist model", () => {
    expect(CAMPUS_INTERACTIVE_MODEL_IDS).toEqual(["qwen3.5-2b-instruct", "qwen3.5-9b-instruct"]);
    expect(CAMPUS_INTERACTIVE_MODEL_IDS).not.toContain(RETAINED_ASSIST_MODEL_ID);
    expect(CAMPUS_INTERACTIVE_MODEL_IDS).not.toEqual(
      expect.arrayContaining([...LEGACY_CAMPUS_MODEL_IDS]),
    );
  });
});
