// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/courses/server", () => ({
  setPublishState: vi.fn(),
}));

import { action as publishAction } from "~/routes/api/courses.id.publish";
import { action as unpublishAction } from "~/routes/api/courses.id.unpublish";
import { setPublishState } from "~/lib/courses/server";

function makeArgs(id: string | undefined, method = "PATCH") {
  return {
    request: new Request(`http://localhost/api/courses/${id ?? ""}/publish`, { method }),
    params: id !== undefined ? { id } : {},
    context: {} as never,
  };
}

describe("PATCH /api/courses/:id/publish route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(setPublishState).mockResolvedValue(new Response(null, { status: 200 }));
  });

  it("returns 405 for non-PATCH methods", async () => {
    const res = await publishAction(makeArgs("course-1", "POST"));
    expect(res.status).toBe(405);
    expect(setPublishState).not.toHaveBeenCalled();
  });

  it("returns 400 when id is missing", async () => {
    const res = await publishAction(makeArgs(undefined));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "COURSE_ID_REQUIRED" });
    expect(setPublishState).not.toHaveBeenCalled();
  });

  it("delegates to setPublishState(request, id, true)", async () => {
    await publishAction(makeArgs("course-1"));
    expect(setPublishState).toHaveBeenCalledWith(
      expect.any(Request),
      "course-1",
      true,
    );
  });

  it("returns the response from setPublishState", async () => {
    const published = { id: "course-1", isPublished: true };
    vi.mocked(setPublishState).mockResolvedValue(
      new Response(JSON.stringify(published), { status: 200 }),
    );
    const res = await publishAction(makeArgs("course-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(published);
  });
});

describe("PATCH /api/courses/:id/unpublish route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(setPublishState).mockResolvedValue(new Response(null, { status: 200 }));
  });

  it("returns 405 for non-PATCH methods", async () => {
    const res = await unpublishAction(makeArgs("course-1", "DELETE"));
    expect(res.status).toBe(405);
    expect(setPublishState).not.toHaveBeenCalled();
  });

  it("returns 400 when id is missing", async () => {
    const res = await unpublishAction(makeArgs(undefined));
    expect(res.status).toBe(400);
    expect(setPublishState).not.toHaveBeenCalled();
  });

  it("delegates to setPublishState(request, id, false)", async () => {
    await unpublishAction(makeArgs("course-1"));
    expect(setPublishState).toHaveBeenCalledWith(
      expect.any(Request),
      "course-1",
      false,
    );
  });
});
