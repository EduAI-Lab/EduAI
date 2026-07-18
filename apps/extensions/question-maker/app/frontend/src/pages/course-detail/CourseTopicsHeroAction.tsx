/**
 * Course-hero topic control — sync/create topics from the course banner.
 *
 * The topic chips themselves render via the shared CourseHeroCard's `topics`
 * prop; this is the compact top-right action that manages them. Courses linked
 * to EduAI Core get a one-click pull ("Sync"); every course gets a create-topic
 * dialog. Topic deletion stays in Core (source of truth) and is not exposed.
 */
import { useCallback, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@eduai/ui';
import { IconLoader2, IconPlus, IconRefresh } from '@tabler/icons-react';
import { courseService } from '../../services/courseService';
import { useToast } from '../../components/ui/use-toast';

interface CourseTopicsHeroActionProps {
  courseId: number;
  /** True when the course is linked to an EduAI Core course (sync available). */
  isLinked: boolean;
  canManage: boolean;
  onTopicsChange: () => void;
}

const HERO_BUTTON_CLASS =
  'border-white/30 bg-white/15 text-white hover:bg-white/25 hover:text-white backdrop-blur-sm';

export const CourseTopicsHeroAction = ({
  courseId,
  isLinked,
  canManage,
  onTopicsChange,
}: CourseTopicsHeroActionProps) => {
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSyncFromCore = useCallback(async () => {
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

  const handleCreateTopic = useCallback(async () => {
    if (!newTopicName.trim()) {
      toast({ title: 'Error', description: 'Topic name cannot be empty.', variant: 'destructive' });
      return;
    }
    setIsCreating(true);
    try {
      await courseService.createTopic(courseId, newTopicName.trim());
      setNewTopicName('');
      setIsCreateOpen(false);
      toast({ title: 'Topic created', description: `"${newTopicName}" has been created.` });
      onTopicsChange();
    } catch (error) {
      console.error('Failed to create topic:', error);
      toast({ title: 'Error', description: 'Failed to create topic.', variant: 'destructive' });
    } finally {
      setIsCreating(false);
    }
  }, [newTopicName, courseId, toast, onTopicsChange]);

  if (!canManage) return null;

  return (
    <>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            {isLinked ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={HERO_BUTTON_CLASS}
                onClick={() => void handleSyncFromCore()}
                disabled={isSyncing}
                aria-label="Sync topics from EduAI"
              >
                <IconRefresh className={`size-4${isSyncing ? ' animate-spin' : ''}`} />
                {isSyncing ? 'Syncing…' : 'Sync now'}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={HERO_BUTTON_CLASS}
                onClick={() => setIsCreateOpen(true)}
                aria-label="Create topic"
              >
                <IconPlus className="size-4" />
                Create topic
              </Button>
            )}
          </TooltipTrigger>
          <TooltipContent>
            {isLinked ? 'Sync topics from EduAI Core' : 'Create a course topic'}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Topic</DialogTitle>
            <DialogDescription>
              Add a new topic to organize questions for this course.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              placeholder="Topic name"
              value={newTopicName}
              onChange={(e) => setNewTopicName(e.target.value)}
            />
            <Button onClick={handleCreateTopic} disabled={isCreating} className="flex-shrink-0">
              {isCreating && <IconLoader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
