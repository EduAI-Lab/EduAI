export type CourseChangeAction =
  | { kind: "noop" }
  | { kind: "update"; courseCode: string | null }
  | { kind: "new-chat"; courseCode: string | null; to: string };

type ResolveCourseChangeActionOptions = {
  currentCourseCode: string | null;
  nextCourseCode: string | null;
  chatId: string | null;
};

/**
 * Persisted chats are pinned to one course. Changing course while viewing one
 * must start a new chat instead of submitting the old chatId with new context.
 */
export function resolveCourseChangeAction({
  currentCourseCode,
  nextCourseCode,
  chatId,
}: ResolveCourseChangeActionOptions): CourseChangeAction {
  if (nextCourseCode === currentCourseCode) {
    return { kind: "noop" };
  }

  if (!chatId) {
    return { kind: "update", courseCode: nextCourseCode };
  }

  const query = nextCourseCode
    ? `?courseCode=${encodeURIComponent(nextCourseCode)}`
    : "";

  return {
    kind: "new-chat",
    courseCode: nextCourseCode,
    to: `/chat${query}`,
  };
}
