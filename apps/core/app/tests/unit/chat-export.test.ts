import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildChatExportDocument,
  buildChatExportFilename,
  buildChatExportHtmlFromDom,
  defaultExportTitle,
  expandCollapsiblesInClone,
  extractMessageText,
  sanitizeExportClone,
} from "~/lib/chat-export";
import type { ChatExportMessage } from "~/lib/chat-export";

const userMessage: ChatExportMessage = {
  id: "user-1",
  role: "user",
  content: "Explain recursion briefly.",
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

describe("defaultExportTitle", () => {
  it("uses the first user message as the title", () => {
    expect(defaultExportTitle([userMessage])).toBe("Explain recursion briefly.");
  });
});

describe("sanitizeExportClone", () => {
  it("removes excluded elements and buttons", () => {
    document.body.innerHTML = `
      <div id="root">
        <div class="message">Keep me</div>
        <div data-chat-export-exclude>Remove me</div>
        <button type="button">Copy</button>
      </div>
    `;

    const root = document.getElementById("root") as HTMLElement;
    sanitizeExportClone(root);

    expect(root.querySelector(".message")).not.toBeNull();
    expect(root.querySelector("[data-chat-export-exclude]")).toBeNull();
    expect(root.querySelector("button")).toBeNull();
  });
});

describe("expandCollapsiblesInClone", () => {
  it("forces collapsible content to remain visible", () => {
    document.body.innerHTML = `
      <div id="root">
        <div data-slot="collapsible" data-state="closed">
          <div data-slot="collapsible-content" hidden style="height: 0; overflow: hidden;">
            Tool output
          </div>
        </div>
      </div>
    `;

    const root = document.getElementById("root") as HTMLElement;
    expandCollapsiblesInClone(root);

    const content = root.querySelector(
      '[data-slot="collapsible-content"]',
    ) as HTMLElement;
    expect(content.hidden).toBe(false);
    expect(content.style.display).toBe("block");
    expect(content.style.height).toBe("auto");
  });
});

describe("buildChatExportDocument", () => {
  it("wraps exported content in a chat-like shell", () => {
    const html = buildChatExportDocument('<div class="message">Hello</div>', {
      title: "Recursion chat",
      exportedAt: new Date("2026-06-18T12:00:00.000Z"),
      modelName: "GPT-4.1",
      pageBackground: "linear-gradient(to bottom right, white, gray)",
      pageColor: "rgb(20, 20, 20)",
      pageFontFamily: "Outfit, sans-serif",
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<h1>Chat</h1>");
    expect(html).toContain('<div class="message">Hello</div>');
    expect(html).toContain("Model: GPT-4.1");
    expect(html).toContain("font-family:Outfit, sans-serif");
  });
});

describe("buildChatExportHtmlFromDom", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="chat-export-root" class="max-w-4xl mx-auto space-y-6">
        <div class="flex justify-end mb-4">
          <div class="rounded-lg px-4 py-3 bg-primary text-primary-foreground">
            Explain recursion briefly.
          </div>
        </div>
        <div data-chat-export-exclude>Temporary typing indicator</div>
      </div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("exports the rendered chat markup instead of rebuilding it", () => {
    const root = document.getElementById("chat-export-root") as HTMLElement;
    const html = buildChatExportHtmlFromDom(root, {
      title: "Recursion chat",
      exportedAt: new Date("2026-06-18T12:00:00.000Z"),
    });

    expect(html).toContain("Explain recursion briefly.");
    expect(html).not.toContain("Temporary typing indicator");
    expect(html).toContain('class="flex justify-end mb-4"');
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
