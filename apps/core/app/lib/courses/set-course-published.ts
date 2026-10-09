/** A refused publish/unpublish: `message` is the server's error code, `status` its HTTP status. */
export class CoursePublishError extends Error {
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "CoursePublishError";
    this.status = status;
  }
}

/**
 * Publish or unpublish a course through `PATCH /api/courses/:id/publish` or
 * `/unpublish`. The endpoint enforces who may (#1939); this only reports it.
 */
export async function setCoursePublished(
  courseId: string,
  publish: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const action = publish ? "publish" : "unpublish";
  const res = await fetchImpl(`/api/courses/${encodeURIComponent(courseId)}/${action}`, {
    method: "PATCH",
  });
  if (res.ok) return;

  // A proxy error page is not JSON; fall back rather than mask the status.
  const body: { error?: string } = await res.json().catch(() => ({}));
  throw new CoursePublishError(body.error ?? "COURSE_PUBLISH_FAILED", res.status);
}
