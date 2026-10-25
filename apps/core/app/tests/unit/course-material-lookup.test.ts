// #1997: the topic file picker reads every course file, page by page.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchAllCourseMaterials,
  fetchCourseMaterialsByIds,
  MAX_LISTED_COURSE_FILES,
} from "~/hooks/api/course-material-lookup";

function page(ids: string[], nextCursor: string | null) {
  return new Response(JSON.stringify({ materials: ids.map((id) => ({ id })), nextCursor }));
}

afterEach(() => vi.unstubAllGlobals());

describe("course material lookup", () => {
  it("follows the cursor until the last page, 100 files at a time", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(["a", "b"], "b"))
      .mockResolvedValueOnce(page(["c"], null));
    vi.stubGlobal("fetch", fetchMock);

    const { materials, truncated } = await fetchAllCourseMaterials("c 1");

    expect(materials.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(truncated).toBe(false);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/courses/c%201/materials?limit=100",
      "/api/courses/c%201/materials?limit=100&cursor=b",
    ]);
  });

  it("stops at the listing cap and says the list is cut short", async () => {
    const full = Array.from({ length: 100 }, (_, i) => String(i));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => page(full, "next")),
    );
    const { materials, truncated } = await fetchAllCourseMaterials("c1");
    expect(materials).toHaveLength(MAX_LISTED_COURSE_FILES);
    expect(truncated).toBe(true);
  });

  it("reads specific files by id, and nothing for no ids", async () => {
    const fetchMock = vi.fn(async () => page(["f1"], null));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchCourseMaterialsByIds("c1", [])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(fetchCourseMaterialsByIds("c1", ["f1", "f2"])).resolves.toEqual([{ id: "f1" }]);
    expect(fetchMock).toHaveBeenCalledWith("/api/courses/c1/materials?ids=f1%2Cf2");
  });

  it("throws on a failed page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 500 })),
    );
    await expect(fetchAllCourseMaterials("c1")).rejects.toThrow("Loading files failed (500)");
  });
});
