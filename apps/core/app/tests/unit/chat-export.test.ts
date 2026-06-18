import { describe, it, expect } from "vitest";
import {
  buildChatExportFilename,
  buildChatExportHtml,
  extractMessageText,
} from "~/lib/chat-export";
import type { ChatExportMessage } from "~/lib/chat-export";

const userMessage: ChatExportMessage = {
  id: "user-1",
  role: "user",
  content: "Explain recursion briefly.",
};

const assistantMessage: ChatExportMessage = {
  id: "assistant-1",
  role: "assistant",
  content: "Recursion is when a function calls **itself**.\n\n```js\nfunction fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }\n```",
};

describe("extractMessageText", () => {
  it("reads plain string content", () => {
    expect(extractMessageText(userMessage)).toBe("Explain recursion briefly.");
  });

  it("reads text parts when present", () => {
    const message: ChatExportMessage = {
      id: "parts-1",
      role: "assistant",
      parts: [
        { type: "text", text: "Line one" },
        { type: "text", text: "Line two" },
      ],
    };

    expect(extractMessageText(message)).toBe("Line one\nLine two");
  });
});

describe("buildChatExportHtml", () => {
  it("includes user and assistant bubbles with markdown rendering", () => {
    const html = buildChatExportHtml({
      messages: [userMessage, assistantMessage],
      title: "Recursion chat",
      exportedAt: new Date("2026-06-18T12:00:00.000Z"),
      modelName: "GPT-4.1",
      answeredByLabels: { "assistant-1": "GPT-4.1" },
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Recursion chat");
    expect(html).toContain("Explain recursion briefly.");
    expect(html).toContain('<strong>itself</strong>');
    expect(html).toContain("function fact(n)");
    expect(html).toContain("Answered by GPT-4.1");
    expect(html).toContain("Model: GPT-4.1");
  });

  it("escapes user-provided HTML in user messages", () => {
    const html = buildChatExportHtml({
      messages: [
        {
          id: "unsafe-user",
          role: "user",
          content: '<script>alert("x")</script>',
        },
      ],
    });

    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert");
  });

  it("includes tool usage notes for assistant messages", () => {
    const html = buildChatExportHtml({
      messages: [
        {
          id: "assistant-tools",
          role: "assistant",
          parts: [
            {
              type: "tool-invocation",
              toolInvocation: { toolName: "search_materials" },
            },
            { type: "text", text: "Here is what I found." },
          ],
        },
      ],
    });

    expect(html).toContain("Used tools: search_materials");
    expect(html).toContain("Here is what I found.");
  });
});

describe("buildChatExportFilename", () => {
  it("builds a stable html filename from title and date", () => {
    expect(
      buildChatExportFilename({
        title: "Recursion chat",
        exportedAt: new Date("2026-06-18T12:00:00.000Z"),
      }),
    ).toBe("eduai-chat-recursion-chat-2026-06-18.html");
  });
});
