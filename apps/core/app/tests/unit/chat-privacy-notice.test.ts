import { beforeEach, describe, expect, it } from "vitest";
import {
  acknowledgeChatPrivacyNotice,
  CHAT_PRIVACY_NOTICE_KEY,
  hasAcknowledgedChatPrivacyNotice,
} from "~/lib/chat/chat-privacy-notice";

describe("chat-privacy-notice", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts unacknowledged for a user", () => {
    expect(hasAcknowledgedChatPrivacyNotice("user-1")).toBe(false);
  });

  it("persists acknowledgment per user", () => {
    acknowledgeChatPrivacyNotice("user-1");
    expect(hasAcknowledgedChatPrivacyNotice("user-1")).toBe(true);
    expect(hasAcknowledgedChatPrivacyNotice("user-2")).toBe(false);
    expect(localStorage.getItem(`${CHAT_PRIVACY_NOTICE_KEY}:user-1`)).toBe("1");
  });
});
