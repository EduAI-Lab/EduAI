import { afterEach, describe, expect, it, vi } from "vitest";
import { loadStudyBuddyModel, saveStudyBuddyModel } from "~/lib/study-buddy-model";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("study buddy model storage (#2025)", () => {
  it("keeps each account's pick separate", () => {
    saveStudyBuddyModel("s1", "vllm:llama-3");
    saveStudyBuddyModel("s2", "ollama:qwen2.5:3b");
    expect(loadStudyBuddyModel("s1")).toBe("vllm:llama-3");
    expect(loadStudyBuddyModel("s2")).toBe("ollama:qwen2.5:3b");
  });

  it("stores nothing without a signed-in user", () => {
    saveStudyBuddyModel(null, "vllm:llama-3");
    expect(localStorage.length).toBe(0);
    expect(loadStudyBuddyModel(null)).toBeNull();
  });

  it("survives a localStorage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveStudyBuddyModel("s1", "vllm:llama-3")).not.toThrow();
    expect(loadStudyBuddyModel("s1")).toBeNull();
  });
});
