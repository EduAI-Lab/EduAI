/**
 * #1939 — the request behind the course page's Publish / Unpublish control.
 *
 * Every component test injects a mock handler, so this is the one place the
 * endpoint choice is pinned: a swapped publish/unpublish would otherwise close
 * the confirm dialog as if it worked while the course stayed as it was.
 */
import { describe, expect, it, vi } from "vitest";

import { CoursePublishError, setCoursePublished } from "~/lib/courses/set-course-published";

function respond(status: number, body: string): typeof fetch {
  return vi.fn(async () => new Response(body, { status }));
}

describe("setCoursePublished", () => {
  it("PATCHes the publish endpoint to publish", async () => {
    const fetchImpl = respond(200, "{}");
    await setCoursePublished("c1", true, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith("/api/courses/c1/publish", { method: "PATCH" });
  });

  it("PATCHes the unpublish endpoint to unpublish", async () => {
    const fetchImpl = respond(200, "{}");
    await setCoursePublished("c1", false, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith("/api/courses/c1/unpublish", { method: "PATCH" });
  });

  it("rejects with the status and the server's error code when refused", async () => {
    const result = setCoursePublished("c1", true, respond(403, '{"error":"POLICY_DENIED"}'));
    await expect(result).rejects.toBeInstanceOf(CoursePublishError);
    await expect(result).rejects.toMatchObject({ status: 403, message: "POLICY_DENIED" });
  });

  it("still rejects, with a fallback code, when the error body is not JSON", async () => {
    await expect(
      setCoursePublished("c1", false, respond(502, "<html>Bad Gateway</html>")),
    ).rejects.toMatchObject({ status: 502, message: "COURSE_PUBLISH_FAILED" });
  });
});
