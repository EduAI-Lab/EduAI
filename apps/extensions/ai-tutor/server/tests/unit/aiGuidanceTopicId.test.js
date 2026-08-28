import { describe, it, expect } from "vitest";
import { TeachRequestSchema, CustomRequestSchema } from "../../../shared/schemas/aiGuidance.js";

// #1596 review: `topicId` was declared `z.number().int()` while `Topic.id` is a
// cuid string, so every real focus-topic selection was rejected at the boundary
// with a 400 and never reached `resolveTopicName`, which compares the id against
// `mainTopic.id` and the join rows' `topicId` (both cuids).

const base = {
  knowledgeLevel: "beginner",
  message: "Explain base cases",
  apiKey: "test-key",
};

describe("AI request schemas — topicId (#1596)", () => {
  for (const [name, schema] of [
    ["TeachRequestSchema", TeachRequestSchema],
    ["CustomRequestSchema", CustomRequestSchema],
  ]) {
    it(`${name} accepts the cuid topic ids the client sends`, () => {
      const parsed = schema.parse({ ...base, topicId: "cm4t0p1cabcdef0123456789" });
      expect(parsed.topicId).toBe("cm4t0p1cabcdef0123456789");
    });

    it(`${name} still allows an omitted topicId`, () => {
      expect(schema.parse(base).topicId).toBeUndefined();
    });

    it(`${name} rejects an empty topicId rather than treating it as "no topic"`, () => {
      expect(() => schema.parse({ ...base, topicId: "" })).toThrow();
    });
  }
});
