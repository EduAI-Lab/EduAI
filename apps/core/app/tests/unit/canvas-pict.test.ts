import { describe, expect, it } from "vitest";
import { buildUpstreamCanvasFile } from "../helpers/canvas-pict";

describe("canvas-pict helpers", () => {
  it("buildUpstreamCanvasFile fills defaults", () => {
    const file = buildUpstreamCanvasFile({ canvasFileId: "1001" });

    expect(file).toEqual({
      canvasFileId: "1001",
      displayName: "File 1001.txt",
      url: "mock://canvas/files/1001",
      updatedAt: new Date("2025-01-10T12:00:00.000Z"),
      checksum: undefined,
      published: true,
    });
  });

  it("buildUpstreamCanvasFile respects overrides", () => {
    const updatedAt = new Date("2025-06-01T00:00:00.000Z");
    const file = buildUpstreamCanvasFile({
      canvasFileId: "42",
      displayName: "Lecture 1",
      url: "mock://custom",
      updatedAt,
      checksum: "abc",
      published: false,
    });

    expect(file).toMatchObject({
      canvasFileId: "42",
      displayName: "Lecture 1",
      url: "mock://custom",
      updatedAt,
      checksum: "abc",
      published: false,
    });
  });
});
