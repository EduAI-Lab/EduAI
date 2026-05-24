import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/courses/server", () => ({
  getCourse: vi.fn(),
  handleCourseRequest: vi.fn(),
}));

import { loader } from "~/routes/api/courses.id";
import { getCourse } from "~/lib/courses/server";

const COURSE = {
  id: "course-1",
  name: "Algorithms",
  code: "COSC 101",
  deletedAt: null,
};

function makeArgs(id?: string) {
  return {
    request: new Request(`http://localhost/api/courses/${id ?? ""}`),
    params: id !== undefined ? { id } : {},
    context: {} as never,
  };
}

describe("GET /api/courses/:id loader", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when id is missing", async () => {
    const res = await loader(makeArgs() as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "COURSE_ID_REQUIRED" });
    expect(getCourse).not.toHaveBeenCalled();
  });

  it("returns 404 COURSE_NOT_FOUND when getCourse returns null", async () => {
    vi.mocked(getCourse).mockResolvedValue(null);
    const res = await loader(makeArgs("missing") as never);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns 200 with flat course JSON on success", async () => {
    vi.mocked(getCourse).mockResolvedValue(COURSE as never);
    const res = await loader(makeArgs("course-1") as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(COURSE);
    expect(getCourse).toHaveBeenCalledWith("course-1");
  });
});
