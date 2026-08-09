// @vitest-environment node
//
// app/lib/canvas/client.ts is the browser-side fetch wrapper for the Canvas
// integration (distinct from client.server.ts, which talks to Canvas itself
// and is already covered by canvas-client.test.ts).

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectCanvas,
  disconnectCanvas,
  discoverCanvasMaterials,
  excludeCanvasMaterial,
  getCanvasIntegration,
  linkCanvasRoster,
  listCanvasCourses,
  syncCanvasCourses,
  syncCanvasMaterials,
  unexcludeCanvasMaterial,
} from "~/lib/canvas/client";

const originalFetch = global.fetch;

function mockFetch(body: unknown, status = 200) {
  global.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status })) as never;
}

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("getCanvasIntegration", () => {
  it("returns the integration data", async () => {
    mockFetch({ success: true, data: { id: "int-1" } });
    expect(await getCanvasIntegration()).toEqual({ id: "int-1" });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/canvas/integration",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("returns null when there is no data", async () => {
    mockFetch({ success: true });
    expect(await getCanvasIntegration()).toBeNull();
  });

  it("throws the server error on failure", async () => {
    mockFetch({ success: false, error: "not connected" }, 400);
    await expect(getCanvasIntegration()).rejects.toThrow("not connected");
  });

  it("throws a generic error when the response is not ok with no error field", async () => {
    mockFetch({ success: false }, 500);
    await expect(getCanvasIntegration()).rejects.toThrow("Canvas request failed");
  });
});

describe("connectCanvas", () => {
  it("POSTs the input and returns the integration", async () => {
    mockFetch({ success: true, data: { id: "int-1" } });
    const result = await connectCanvas({ canvasUrl: "https://canvas.test" });
    expect(result).toEqual({ id: "int-1" });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/canvas/connect",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws when the response carries no data", async () => {
    mockFetch({ success: true });
    await expect(connectCanvas({ canvasUrl: "https://canvas.test" })).rejects.toThrow(
      "Canvas connect did not return integration data",
    );
  });
});

describe("disconnectCanvas", () => {
  it("DELETEs the connection", async () => {
    mockFetch({ success: true });
    await disconnectCanvas();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/canvas/disconnect",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("listCanvasCourses", () => {
  it("returns the course list, defaulting to empty", async () => {
    mockFetch({ success: true, data: { courses: [{ id: "c1" }] } });
    expect(await listCanvasCourses()).toEqual([{ id: "c1" }]);
  });

  it("defaults to an empty array with no data", async () => {
    mockFetch({ success: true });
    expect(await listCanvasCourses()).toEqual([]);
  });
});

describe("syncCanvasCourses", () => {
  it("returns the sync result", async () => {
    mockFetch({ success: true, data: { imported: 2 } });
    const result = await syncCanvasCourses({ courseIds: ["c1"] } as never);
    expect(result).toEqual({ imported: 2 });
  });

  it("throws when the result data is missing", async () => {
    mockFetch({ success: true });
    await expect(syncCanvasCourses({ courseIds: [] } as never)).rejects.toThrow(
      "Canvas sync did not return result data",
    );
  });
});

describe("discoverCanvasMaterials", () => {
  it("requests with recheck=true and returns the files", async () => {
    mockFetch({ success: true, data: { files: [{ id: "f1" }] } });
    const result = await discoverCanvasMaterials("course-1");
    expect(result).toEqual([{ id: "f1" }]);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/courses/course-1/canvas-materials?recheck=true",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("defaults to an empty array with no data", async () => {
    mockFetch({ success: true });
    expect(await discoverCanvasMaterials("course-1")).toEqual([]);
  });

  it("throws the server error on failure", async () => {
    mockFetch({ success: false, error: "boom" }, 500);
    await expect(discoverCanvasMaterials("course-1")).rejects.toThrow("boom");
  });
});

describe("syncCanvasMaterials", () => {
  it("POSTs canvasFileIds and returns the result", async () => {
    mockFetch({ success: true, data: { synced: 1 } });
    const result = await syncCanvasMaterials("course-1", ["file-1"]);
    expect(result).toEqual({ synced: 1 });
  });

  it("throws when the result data is missing", async () => {
    mockFetch({ success: true });
    await expect(syncCanvasMaterials("course-1", ["file-1"])).rejects.toThrow(
      "Canvas material sync did not return result data",
    );
  });
});

describe("excludeCanvasMaterial / unexcludeCanvasMaterial", () => {
  it("excludes a material", async () => {
    mockFetch({ success: true });
    await excludeCanvasMaterial("course-1", "file-1");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/courses/course-1/canvas-materials/exclusions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws the server error when excluding fails", async () => {
    mockFetch({ success: false, error: "cannot exclude" }, 400);
    await expect(excludeCanvasMaterial("course-1", "file-1")).rejects.toThrow("cannot exclude");
  });

  it("un-excludes a material", async () => {
    mockFetch({ success: true });
    await unexcludeCanvasMaterial("course-1", "file-1");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/courses/course-1/canvas-materials/exclusions",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("throws a fallback error when un-excluding fails with no body error", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 500 })) as never;
    await expect(unexcludeCanvasMaterial("course-1", "file-1")).rejects.toThrow(
      "Failed to un-exclude Canvas file",
    );
  });
});

describe("linkCanvasRoster", () => {
  it("returns the link result", async () => {
    mockFetch({ success: true, data: { linked: true } });
    const result = await linkCanvasRoster("12345");
    expect(result).toEqual({ linked: true });
  });

  it("throws when the result data is missing", async () => {
    mockFetch({ success: true });
    await expect(linkCanvasRoster("12345")).rejects.toThrow(
      "Link roster did not return result data",
    );
  });
});
