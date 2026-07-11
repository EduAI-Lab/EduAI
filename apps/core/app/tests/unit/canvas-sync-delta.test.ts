import { describe, expect, it } from "vitest";
import { computeCanvasSyncDelta } from "~/lib/canvas/sync.server";

describe("computeCanvasSyncDelta", () => {
  it("syncs newly checked courses and keeps still-checked courses in toSync", () => {
    const delta = computeCanvasSyncDelta(["1", "2"], ["1", "2", "3"], ["1", "2", "3"]);
    expect(delta.toSync).toEqual(["1", "2", "3"]);
    expect(delta.toUnsync).toEqual([]);
  });

  it("unsyncs courses omitted from the selection that are still live in Canvas", () => {
    const delta = computeCanvasSyncDelta(["1", "2", "3"], ["1"], ["1", "2", "3"]);
    expect(delta.toSync).toEqual(["1"]);
    expect(delta.toUnsync).toEqual(["2", "3"]);
  });

  it("unsyncs all previously synced courses when selection is empty and all are live", () => {
    const delta = computeCanvasSyncDelta(["1", "2"], [], ["1", "2"]);
    expect(delta.toSync).toEqual([]);
    expect(delta.toUnsync).toEqual(["1", "2"]);
  });

  it("does not unsync a previously synced course that has dropped out of the live Canvas list", () => {
    // Course "2" is synced but no longer appears in the instructor's live Canvas courses
    // (term ended, access revoked, etc.) — it must not be silently unsynced.
    const delta = computeCanvasSyncDelta(["1", "2"], ["1"], ["1"]);
    expect(delta.toSync).toEqual(["1"]);
    expect(delta.toUnsync).toEqual([]);
  });
});
