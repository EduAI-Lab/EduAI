/**
 * @file Publish-cascade rules the UI mirrors: a lesson needs its course and
 * module published first (the server enforces the same).
 */
import api, { FULL_TREE_READ_PAGE_SIZE } from "./api";
import type { Lesson } from "./types";

type Parent = { title?: string | null; isPublished: boolean } | null | undefined;

/** Why `lesson` can't be published yet, or null when it can (or is already published). */
export function lessonPublishBlockedReason(
  lesson: { title: string; isPublished: boolean },
  course: Parent,
  module: Parent,
): string | null {
  if (lesson.isPublished) return null;
  const parentName = !course?.isPublished
    ? course?.title || "the parent course"
    : !module?.isPublished
      ? module?.title || "the parent module"
      : null;
  return parentName ? `${parentName} is unpublished, so you can't publish ${lesson.title}.` : null;
}

export async function unpublishedLessons(moduleId: number): Promise<Lesson[]> {
  const page = await api.lessonsForModule(moduleId, { pageSize: FULL_TREE_READ_PAGE_SIZE });
  return page.data.filter((lesson) => !lesson.isPublished);
}

/** Publish each lesson; one failure doesn't stop the rest. */
export async function publishLessons(lessons: Lesson[]) {
  const results = await Promise.allSettled(lessons.map((l) => api.publishLesson(l.id)));
  const failed = results.filter((r) => r.status === "rejected").length;
  return { published: lessons.length - failed, failed };
}
