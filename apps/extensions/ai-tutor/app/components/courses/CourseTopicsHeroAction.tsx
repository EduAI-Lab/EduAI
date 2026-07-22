/**
 * @file Course-hero topic control — ai-tutor adapter over the shared
 *   `@eduai/ui` `CourseTopicsHeroAction`.
 *
 * Responsibility: wires ai-tutor's own data layer (`useCourseTopics` +
 *   `useAtPermissions`) into the shared presentational component. The topic
 *   chips themselves render via the shared CourseHeroCard's `topics` prop.
 *   EduAI-sourced courses have their topics pulled automatically from Core
 *   (see server routes/topics.js); locally-authored courses get a
 *   create-topic dialog here. ai-tutor has no sync endpoint, so linked
 *   courses render nothing (no `onSync` is passed).
 * Used by: `app/routes/instructor.course.tsx` (hero `headerAction`).
 * Gotchas:
 *   - Shares the caller's `useCourseTopics` instance so the hero chips and
 *     this control stay in sync after a create.
 *   - Renders nothing when the user lacks `canManageTopics` (chips still
 *     show), or for EduAI-sourced courses (no manual action needed — #1031).
 * Related: hooks/useCourseTopics
 */
import { CourseTopicsHeroAction as SharedCourseTopicsHeroAction } from '@eduai/ui';
import { useAtPermissions } from '~/hooks/useAtPermissions';
import type { CourseTopicsState } from '~/hooks/useCourseTopics';
import type { Course } from '~/lib/types';

export function CourseTopicsHeroAction({
  course,
  courseTopics,
}: {
  course: Course;
  courseTopics: CourseTopicsState;
}) {
  const perms = useAtPermissions();

  // EduAI-sourced courses have their topics pulled automatically from Core
  // on every read (routes/topics.js) — no manual action needed here. Gated
  // on `coreOfferingId` to match the server's sync/create gate exactly
  // (routes/topics.js checks `course.coreOfferingId`); every CourseOffering
  // is now a Core anchor row (#1072), so this is effectively always true —
  // the field stays optional here only defensively.
  const isEduAiCourse = !!course.coreOfferingId;

  return (
    <SharedCourseTopicsHeroAction
      canManage={perms.canManageTopics}
      isLinked={isEduAiCourse}
      onCreateTopic={async (name) => {
        await courseTopics.createTopic(name);
      }}
      createDialogDescription="Add a new topic to organize this course's content."
      onCreateError={(error) => console.error('Failed to create topic', error)}
    />
  );
}
