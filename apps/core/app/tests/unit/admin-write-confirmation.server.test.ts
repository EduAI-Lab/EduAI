// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeWritePreview,
  registerWritePreview,
  resetWritePreviewsForTests,
} from "~/lib/agent-tools/admin-write-confirmation.server";

afterEach(() => {
  resetWritePreviewsForTests();
  vi.useRealTimers();
});

describe("admin-write-confirmation", () => {
  it("prunes expired previews on register so the map cannot grow unbounded", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    registerWritePreview("actor-1", "createUser", { email: "a@b.c" }, 1000, "turn-a");
    expect(consumeWritePreview("actor-1", "createUser", { email: "a@b.c" }, "turn-b")).toBe("ok");

    registerWritePreview("actor-1", "createUser", { email: "stale@b.c" }, 1000, "turn-a");
    vi.setSystemTime(now + 2000);
    registerWritePreview("actor-1", "createUser", { email: "fresh@b.c" }, 60_000, "turn-a");

    expect(consumeWritePreview("actor-1", "createUser", { email: "stale@b.c" }, "turn-b")).toBe(
      "missing",
    );
    expect(consumeWritePreview("actor-1", "createUser", { email: "fresh@b.c" }, "turn-b")).toBe(
      "ok",
    );
  });

  it("rejects same-turn confirmation without consuming the preview", () => {
    registerWritePreview("actor-1", "createUser", { email: "a@b.c" }, 60_000, "turn-1");
    expect(consumeWritePreview("actor-1", "createUser", { email: "a@b.c" }, "turn-1")).toBe(
      "same_turn",
    );
    expect(consumeWritePreview("actor-1", "createUser", { email: "a@b.c" }, "turn-2")).toBe("ok");
  });
});
