// @vitest-environment node
import { describe, it, expect } from "vitest";
import { chatHistoryRowLabel, relativeChatTime } from "~/components/chat/chat-history-utils";
import type { ChatHistoryItem } from "~/hooks/api/use-chat-history";

describe("chat-history-utils", () => {
  it("prefers preview over title for row label", () => {
    const chat = {
      preview: "How does backprop work?",
      title: "CS101 chat",
    } as ChatHistoryItem;
    expect(chatHistoryRowLabel(chat)).toBe("How does backprop work?");
  });

  it("formats recent timestamps", () => {
    const recent = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(relativeChatTime(recent)).toBe("5m ago");
  });
});
