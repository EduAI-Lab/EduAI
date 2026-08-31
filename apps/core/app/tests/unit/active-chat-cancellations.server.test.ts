import { describe, expect, it, vi } from "vitest";
import {
  cancelActiveChat,
  isValidActiveChatRequestId,
  registerActiveChatCancellation,
} from "~/lib/ai/active-chat-cancellations.server";

const requestId = "9f1ac5c9-2abf-4b1e-b2f9-dbc1697e0aac";
const replacementRequestId = "4d0c8f45-7a5f-4f12-9a73-2f719ea4cc93";
const pendingRequestId = "0f5d2c9e-8b7a-4c6d-a1e2-3f4b5c6d7e8f";
const ownershipRequestId = "4ab91e55-c092-45c0-a748-8c23a4699231";
const userId = "user-1";

describe("active chat cancellations", () => {
  it("cancels an active request exactly once", () => {
    const cancel = vi.fn();
    registerActiveChatCancellation(userId, requestId, cancel);

    expect(cancelActiveChat(userId, requestId)).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancelActiveChat(userId, requestId)).toBe(false);
  });

  it("does not let an earlier stream unregister a replacement", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = registerActiveChatCancellation(userId, replacementRequestId, first);
    registerActiveChatCancellation(userId, replacementRequestId, second);

    unregisterFirst();
    cancelActiveChat(userId, replacementRequestId);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("carries a cancellation request that arrives before registration", () => {
    const cancel = vi.fn();

    expect(cancelActiveChat(userId, pendingRequestId)).toBe(false);
    registerActiveChatCancellation(userId, pendingRequestId, cancel);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancelActiveChat(userId, pendingRequestId)).toBe(false);
  });

  it("does not let one user cancel another user's request", () => {
    const cancel = vi.fn();
    registerActiveChatCancellation(userId, ownershipRequestId, cancel);

    expect(cancelActiveChat("user-2", ownershipRequestId)).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(cancelActiveChat(userId, ownershipRequestId)).toBe(true);
  });

  it("accepts only UUID v4 request ids", () => {
    expect(isValidActiveChatRequestId(requestId)).toBe(true);
    expect(isValidActiveChatRequestId("not-a-request-id")).toBe(false);
    expect(isValidActiveChatRequestId("9f1ac5c9-2abf-3b1e-b2f9-dbc1697e0aac")).toBe(false);
  });
});
