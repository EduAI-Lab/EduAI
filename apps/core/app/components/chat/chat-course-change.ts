export type CourseChangeAction =
  | { kind: "noop" }
  | { kind: "update"; courseId: string | null }
  | { kind: "new-chat"; courseId: string | null; to: string };

type ResolveCourseChangeActionOptions = {
  currentCourseId: string | null;
  nextCourseId: string | null;
  chatId: string | null;
};

/**
 * Persisted chats are pinned to one course. Changing course while viewing one
 * must start a new chat instead of submitting the old chatId with new context.
 */
export function resolveCourseChangeAction({
  currentCourseId,
  nextCourseId,
  chatId,
}: ResolveCourseChangeActionOptions): CourseChangeAction {
  if (nextCourseId === currentCourseId) {
    return { kind: "noop" };
  }

  if (!chatId) {
    return { kind: "update", courseId: nextCourseId };
  }

  const query = nextCourseId ? `?courseId=${encodeURIComponent(nextCourseId)}` : "";

  return {
    kind: "new-chat",
    courseId: nextCourseId,
    to: `/chat${query}`,
  };
}
