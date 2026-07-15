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

    registerWritePreview("actor-1", "createUser", { email: "a@b.c" }, 1000);
    expect(consumeWritePreview("actor-1", "createUser", { email: "a@b.c" })).toBe(true);

    registerWritePreview("actor-1", "createUser", { email: "stale@b.c" }, 1000);
    vi.setSystemTime(now + 2000);
    registerWritePreview("actor-1", "createUser", { email: "fresh@b.c" }, 60_000);

    expect(consumeWritePreview("actor-1", "createUser", { email: "stale@b.c" })).toBe(false);
    expect(consumeWritePreview("actor-1", "createUser", { email: "fresh@b.c" })).toBe(true);
  });
});
