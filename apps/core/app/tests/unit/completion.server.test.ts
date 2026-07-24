// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveCompletionPrompt } from "~/lib/ai/completion.server";

describe("resolveCompletionPrompt", () => {
  it("prefers body.systemPrompt over system message in messages", () => {
    const result = resolveCompletionPrompt({
      systemPrompt: "Body system",
      messages: [
        { role: "system", content: "Message system" },
        { role: "user", content: "Hello" },
      ],
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.system).toContain("Body system");
    expect(result.system).not.toContain("Message system");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
  });

  it("extracts system role from messages when body field is absent", () => {
    const result = resolveCompletionPrompt({
      messages: [
        { role: "system", content: "You are a question generator." },
        { role: "user", content: "Generate one MCQ." },
      ],
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.system).toContain("You are a question generator.");
    expect(result.messages).toEqual([{ role: "user", content: "Generate one MCQ." }]);
  });

  it("prepends the security policy block", () => {
    const result = resolveCompletionPrompt({
      systemPrompt: "Custom assist prompt.",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.system.startsWith("=== SECURITY POLICY")).toBe(true);
    expect(result.system).toContain("Custom assist prompt.");
  });

  it("rejects when no system prompt is provided", () => {
    const result = resolveCompletionPrompt({
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result).toEqual({
      error: "systemPrompt is required (body field or one system message)",
    });
  });

  it("falls back to system message when body.systemPrompt is empty/whitespace", () => {
    const result = resolveCompletionPrompt({
      systemPrompt: "   ",
      messages: [
        { role: "system", content: "Message system" },
        { role: "user", content: "Hello" },
      ],
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.system).toContain("Message system");
    expect(result.messages).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("rejects unsupported roles", () => {
    const result = resolveCompletionPrompt({
      systemPrompt: "Test",
      messages: [{ role: "tool", content: "nope" }],
    });
    expect(result).toEqual({ error: "Unsupported message role: tool" });
  });
});
