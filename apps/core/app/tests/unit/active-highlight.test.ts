import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CHAT_MESSAGE_ACTIVE_CLASS,
  CHAT_MESSAGE_INACTIVE_CLASS,
  ASSISTIVE_INPUT_ANCHOR_CLASS,
  ASSISTIVE_FOCUS_CHROME_CLASS,
  resolveMessageHighlightRole,
  findLastAssistantIndex,
} from "~/components/assistive/active-highlight";

const cssPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../styles/assistive-active-highlight.css",
);
const css = readFileSync(cssPath, "utf-8");

describe("resolveMessageHighlightRole", () => {
  const thread = [
    { role: "user" },
    { role: "assistant" },
    { role: "user" },
    { role: "assistant" },
  ];

  it("returns null when assistive mode is off", () => {
    expect(resolveMessageHighlightRole(3, thread, false)).toBeNull();
  });

  it("marks only the latest assistant message active", () => {
    expect(resolveMessageHighlightRole(0, thread, true)).toBe("inactive");
    expect(resolveMessageHighlightRole(1, thread, true)).toBe("inactive");
    expect(resolveMessageHighlightRole(2, thread, true)).toBe("inactive");
    expect(resolveMessageHighlightRole(3, thread, true)).toBe("active");
  });

  it("returns null when there is no assistant message", () => {
    expect(resolveMessageHighlightRole(0, [{ role: "user" }], true)).toBeNull();
    expect(findLastAssistantIndex([{ role: "user" }])).toBe(-1);
  });
});

describe("assistive-active-highlight.css", () => {
  it("scopes highlighting under [data-assistive]", () => {
    expect(css).toMatch(/\[data-assistive\]\s*\.chat-message--inactive/);
    expect(css).toMatch(/\[data-assistive\]\s*\.chat-message--active/);
    expect(css).not.toMatch(/^\.chat-message--active\s*\{/m);
  });

  it("restores inactive opacity on hover and focus-within", () => {
    expect(css).toContain(".chat-message--inactive:hover");
    expect(css).toContain(".chat-message--inactive:focus-within");
  });

  it("uses outline and background for active state (not color-only)", () => {
    expect(css).toContain("outline:");
    expect(css).toContain("background-color:");
    expect(css).toContain("box-shadow:");
  });

  it("hides sidebar and focus chrome in focus mode", () => {
    expect(css).toContain("[data-assistive-focus-mode]");
    expect(css).toContain(`[data-sidebar="sidebar"]`);
    expect(css).toContain(`[data-slot="sidebar-gap"]`);
    expect(css).toContain(`.${ASSISTIVE_FOCUS_CHROME_CLASS}`);
  });

  it("exports hook classes referenced by components", () => {
    expect(css).toContain(`.${CHAT_MESSAGE_ACTIVE_CLASS}`);
    expect(css).toContain(`.${CHAT_MESSAGE_INACTIVE_CLASS}`);
    expect(css).toContain(`.${ASSISTIVE_INPUT_ANCHOR_CLASS}`);
  });
});
