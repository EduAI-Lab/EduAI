// @vitest-environment node
import { describe, it, expect } from "vitest";
import { transformAssistiveDisplayCopy } from "~/components/chat/assistive-display-transform";

describe("transformAssistiveDisplayCopy", () => {
  it("relables Top summary and Next? for display only", () => {
    const stored = `**Top summary**
- One bullet

**Next?** Want more detail?`;

    const displayed = transformAssistiveDisplayCopy(stored);

    expect(displayed).toContain("**TLDR**");
    expect(displayed).toContain("**Continue**");
    expect(displayed).not.toContain("**Top summary**");
    expect(displayed).not.toContain("**Next?**");
  });

  it("leaves non-assistive content unchanged", () => {
    const text = "Gradient descent minimizes the loss.";
    expect(transformAssistiveDisplayCopy(text)).toBe(text);
  });

  it("handles case-insensitive Top summary", () => {
    expect(transformAssistiveDisplayCopy("**top summary**")).toBe("**TLDR**");
  });
});
