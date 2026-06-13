import { describe, expect, it } from "vitest";
import { computeCanvasSyncDelta } from "~/lib/canvas/sync.server";

describe("computeCanvasSyncDelta", () => {
  it("syncs newly checked courses and keeps still-checked courses in toSync", () => {
    const delta = computeCanvasSyncDelta(["1", "2"], ["1", "2", "3"]);
    expect(delta.toSync).toEqual(["1", "2", "3"]);
    expect(delta.toUnsync).toEqual([]);
  });

  it("unsyncs courses omitted from the selection", () => {
    const delta = computeCanvasSyncDelta(["1", "2", "3"], ["1"]);
    expect(delta.toSync).toEqual(["1"]);
    expect(delta.toUnsync).toEqual(["2", "3"]);
  });

  it("unsyncs all previously synced courses when selection is empty", () => {
    const delta = computeCanvasSyncDelta(["1", "2"], []);
    expect(delta.toSync).toEqual([]);
    expect(delta.toUnsync).toEqual(["1", "2"]);
  });
});
