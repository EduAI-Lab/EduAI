/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  AddBankMembershipSchema,
  CreateQuestionBankSchema,
  DeleteQuestionBankSchema,
  UpdateQuestionBankSchema,
} from "~/lib/question-banks/schemas";

describe("question-banks schemas", () => {
  it("accepts a valid create payload", () => {
    const parsed = CreateQuestionBankSchema.safeParse({
      name: "Midterm bank",
      description: "Exam prep",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects empty bank names", () => {
    const parsed = CreateQuestionBankSchema.safeParse({ name: "  " });
    expect(parsed.success).toBe(false);
  });

  it("strips unrecognized isDefault on create", () => {
    const parsed = CreateQuestionBankSchema.safeParse({
      name: "Midterm bank",
      isDefault: true,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("isDefault");
    }
  });

  it("accepts partial updates", () => {
    const parsed = UpdateQuestionBankSchema.safeParse({ name: "Renamed" });
    expect(parsed.success).toBe(true);
  });

  it("accepts delete with optional move target", () => {
    const parsed = DeleteQuestionBankSchema.safeParse({
      moveMembershipsToBankId: "clxyz123",
    });
    expect(parsed.success).toBe(true);
  });

  it("requires externalQuestionId for membership", () => {
    const ok = AddBankMembershipSchema.safeParse({
      externalQuestionId: "42",
      source: "question-maker",
    });
    expect(ok.success).toBe(true);

    const bad = AddBankMembershipSchema.safeParse({ source: "question-maker" });
    expect(bad.success).toBe(false);
  });
});
