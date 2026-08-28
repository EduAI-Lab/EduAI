// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createAiJobWorker } from "~/lib/queue/worker.server";

describe("AI-job dequeue worker integration", () => {
  it("is unavailable until the pre-MVP security contract is complete", () => {
    expect(() => createAiJobWorker("ai-jobs-chat", { autorun: false })).toThrow(
      /disabled.*pre-MVP/i,
    );
  });
});
