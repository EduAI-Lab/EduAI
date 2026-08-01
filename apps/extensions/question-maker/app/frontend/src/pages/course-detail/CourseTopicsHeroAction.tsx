/**
 * Course-hero topic control — QM adapter over the shared `@eduai/ui`
 * `CourseTopicsHeroAction`.
 *
 * The topic chips themselves render via the shared CourseHeroCard's `topics`
 * prop; this wires QM's own data layer (courseService + local toast) into the
 * shared presentational component. No manual sync affordance: the backend
 * already pulls topics from Core on every `GET /api/course/:id/topics`, so
 * linked courses render nothing here (matching ai-tutor) and local courses
 * get a create-topic dialog. Topic deletion stays in Core (source of truth)
 * and is not exposed.
 */
import { useCallback } from 'react';
import { CourseTopicsHeroAction as SharedCourseTopicsHeroAction } from '@eduai/ui';
import { courseService } from '../../services/courseService';
import { toast } from 'sonner';

interface CourseTopicsHeroActionProps {
  courseId: number;
  /** True when the course is linked to an EduAI Core course (topics auto-sync on read). */
  isLinked: boolean;
  canManage: boolean;
  onTopicsChange: () => void;
}

export const CourseTopicsHeroAction = ({
  courseId,
  isLinked,
  canManage,
  onTopicsChange,
}: CourseTopicsHeroActionProps) => {

  const handleCreateTopic = useCallback(
    async (name: string) => {
      await courseService.createTopic(courseId, name);
      onTopicsChange();
    },
    [courseId, onTopicsChange],
  );

  return (
    <SharedCourseTopicsHeroAction
      canManage={canManage}
      isLinked={isLinked}
      createTooltip="Create a course topic"
      createDialogDescription="Add a new topic to organize questions for this course."
      showInlineCreateError={false}
      onCreateTopic={handleCreateTopic}
      onCreateSuccess={(name) =>
        toast('Topic created', { description: `"${name}" has been created.` })
      }
      onCreateError={(error) => {
        console.error('Failed to create topic:', error);
        toast.error('Error', { description: 'Failed to create topic.' });
      }}
      onCreateValidationError={(message) =>
        toast.error('Error', { description: message })
      }
    />
  );
};
