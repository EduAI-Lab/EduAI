// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeWritePreview,
  registerWritePreview,
  resetWritePreviewsForTests,
} from "~/lib/agent-tools/admin-write-confirmation.server";

const binding = {
  actorId: "actor-1",
  chatId: "chat-1",
  toolName: "createUser",
  payload: { email: "a@b.c" },
};

afterEach(() => {
  resetWritePreviewsForTests();
  vi.useRealTimers();
});

describe("admin-write-confirmation", () => {
  it("requires the exact code on a later turn and consumes it once", () => {
    const preview = registerWritePreview({ ...binding, turnId: "turn-preview" });

    expect(
      consumeWritePreview({
        ...binding,
        turnId: "turn-preview",
        latestUserMessage: preview.confirmationCode,
      }),
    ).toMatchObject({ kind: "same_turn" });
    expect(
      consumeWritePreview({
        ...binding,
        turnId: "turn-confirm",
        latestUserMessage: `yes ${preview.confirmationCode}`,
      }),
    ).toMatchObject({ kind: "message_mismatch" });
    expect(
      consumeWritePreview({
        ...binding,
        turnId: "turn-confirm",
        latestUserMessage: preview.confirmationCode,
      }),
    ).toEqual({ kind: "ok" });
    expect(
      consumeWritePreview({
        ...binding,
        turnId: "turn-replay",
        latestUserMessage: preview.confirmationCode,
      }),
    ).toEqual({ kind: "missing" });
  });

  it("binds the code to actor, chat, tool, and payload", () => {
    const preview = registerWritePreview({ ...binding, turnId: "turn-preview" });
    const confirmation = {
      turnId: "turn-confirm",
      latestUserMessage: preview.confirmationCode,
    };

    for (const changedBinding of [
      { ...binding, actorId: "actor-2" },
      { ...binding, chatId: "chat-2" },
      { ...binding, toolName: "deleteUser" },
      { ...binding, payload: { email: "other@b.c" } },
    ]) {
      expect(consumeWritePreview({ ...changedBinding, ...confirmation })).toEqual({
        kind: "missing",
      });
    }

    expect(consumeWritePreview({ ...binding, ...confirmation })).toEqual({ kind: "ok" });
  });

  it("reuses an active code and prunes expired previews", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const preview = registerWritePreview({ ...binding, turnId: "turn-preview", ttlMs: 1_000 });
    expect(registerWritePreview({ ...binding, turnId: "turn-other" })).toEqual(preview);

    vi.setSystemTime(now + 2_000);
    registerWritePreview({
      ...binding,
      payload: { email: "fresh@b.c" },
      turnId: "turn-fresh",
    });
    expect(
      consumeWritePreview({
        ...binding,
        turnId: "turn-confirm",
        latestUserMessage: preview.confirmationCode,
      }),
    ).toEqual({ kind: "missing" });
  });
});
