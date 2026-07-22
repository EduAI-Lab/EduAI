/**
 * Course-hero topic control — QM adapter over the shared `@eduai/ui`
 * `CourseTopicsHeroAction`.
 *
 * The topic chips themselves render via the shared CourseHeroCard's `topics`
 * prop; this wires QM's own data layer (courseService + local toast) into the
 * shared presentational component. Courses linked to EduAI Core get a
 * one-click pull ("Sync"); every course gets a create-topic dialog. Topic
 * deletion stays in Core (source of truth) and is not exposed.
 */
import { useCallback, useState } from 'react';
import { CourseTopicsHeroAction as SharedCourseTopicsHeroAction } from '@eduai/ui';
import { courseService } from '../../services/courseService';
import { useToast } from '../../components/ui/use-toast';

interface CourseTopicsHeroActionProps {
  courseId: number;
  /** True when the course is linked to an EduAI Core course (sync available). */
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
  const { toast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const { synced } = await courseService.syncTopicsFromCore(courseId);
      toast({
        title: 'Topics synced',
        description: `${synced} topic${synced === 1 ? '' : 's'} pulled from Core.`,
      });
      onTopicsChange();
    } catch (error) {
      console.error('Failed to sync topics from Core:', error);
      toast({
        title: 'Sync failed',
        description: 'Could not sync topics from Core. Make sure the course is linked.',
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
    }
  }, [courseId, toast, onTopicsChange]);

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
      onSync={handleSync}
      isSyncing={isSyncing}
      syncTooltip="Sync topics from EduAI Core"
      createTooltip="Create a course topic"
      createDialogDescription="Add a new topic to organize questions for this course."
      showInlineCreateError={false}
      onCreateTopic={handleCreateTopic}
      onCreateSuccess={(name) =>
        toast({ title: 'Topic created', description: `"${name}" has been created.` })
      }
      onCreateError={(error) => {
        console.error('Failed to create topic:', error);
        toast({ title: 'Error', description: 'Failed to create topic.', variant: 'destructive' });
      }}
      onCreateValidationError={(message) =>
        toast({ title: 'Error', description: message, variant: 'destructive' })
      }
    />
  );
};
