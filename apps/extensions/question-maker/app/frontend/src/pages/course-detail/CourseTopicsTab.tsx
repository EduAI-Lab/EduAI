/**
 * Topics tab for the course detail page.
 * Lists course topics and lets instructors+ create new ones. Topic deletion is
 * managed in EduAI Core (source of truth) and is intentionally not exposed here.
 * A sync-status banner reports whether local topics are in sync with Core and
 * offers a one-click pull when Core has unsynced topics.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  Button,
  Input,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@eduai/ui';
import {
  IconPlus,
  IconLoader2,
  IconFolderOpen,
  IconCircleCheck,
  IconRefresh,
} from '@tabler/icons-react';
import { Topic } from '../../types/question';
import { courseService } from '../../services/courseService';
import { topicsService, type TopicSyncStatus } from '../../services/topicsService';
import { useQmPermissionsForCourse } from '../../hooks/useQmPermissions';
import { ListSkeleton } from '../../components/shared/Skeletons';
import { EmptyState } from '../../components/shared/EmptyState';
import { useToast } from '../../components/ui/use-toast';

interface CourseTopicsTabProps {
  courseId: number;
  topics: Topic[];
  isLoading: boolean;
  onTopicsChange: () => void;
}

export const CourseTopicsTab = ({
  courseId,
  topics,
  isLoading,
  onTopicsChange,
}: CourseTopicsTabProps) => {
  const { canCreateQuestion } = useQmPermissionsForCourse(courseId);
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const [syncStatus, setSyncStatus] = useState<TopicSyncStatus | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const loadSyncStatus = useCallback(async () => {
    try {
      const status = await topicsService.getSyncStatus(courseId);
      setSyncStatus(status);
    } catch (error) {
      // Sync status is informational; failing to load it should not block the tab.
      console.error('Failed to load topic sync status:', error);
      setSyncStatus(null);
    }
  }, [courseId]);

  useEffect(() => {
    void loadSyncStatus();
  }, [loadSyncStatus, topics.length]);

  const handleSyncFromCore = useCallback(async () => {
    setIsSyncing(true);
    try {
      const { synced } = await courseService.syncTopicsFromCore(courseId);
      toast({
        title: 'Topics synced',
        description: `${synced} topic${synced === 1 ? '' : 's'} pulled from Core.`,
      });
      onTopicsChange();
      await loadSyncStatus();
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
  }, [courseId, toast, onTopicsChange, loadSyncStatus]);

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

  // Number of Core topics not yet present locally (banner CTA copy).
  const unsyncedFromCore = syncStatus
    ? Math.max(0, syncStatus.coreCount - syncStatus.localCount)
    : 0;

  const renderSyncBanner = () => {
    if (!syncStatus) return null;

    if (syncStatus.inSync) {
      return (
        <Alert>
          <IconCircleCheck className="text-success-700" />
          <AlertTitle>Topics are in sync with Core</AlertTitle>
          <AlertDescription>
            {syncStatus.localCount} topic{syncStatus.localCount === 1 ? '' : 's'} match EduAI Core.
          </AlertDescription>
        </Alert>
      );
    }

    return (
      <Alert>
        <IconRefresh className="text-warning-700" />
        <AlertTitle>
          {unsyncedFromCore > 0
            ? `${unsyncedFromCore} topic${unsyncedFromCore === 1 ? '' : 's'} in Core not synced`
            : 'Topics are out of sync with Core'}
        </AlertTitle>
        <AlertDescription className="gap-3">
          <span>Pull the latest topics from EduAI Core to keep this course up to date.</span>
          {canCreateQuestion && (
            <Button size="sm" onClick={() => void handleSyncFromCore()} disabled={isSyncing}>
              {isSyncing ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconRefresh className="size-4" />
              )}
              Sync from Core
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <ListSkeleton count={4} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {renderSyncBanner()}

      {canCreateQuestion && (
        <div className="flex justify-end">
          <Button onClick={() => setIsCreateOpen(true)}>
            <IconPlus className="h-4 w-4 mr-2" />
            Create Topic
          </Button>
        </div>
      )}

      {topics.length === 0 ? (
        <EmptyState
          icon={<IconFolderOpen className="size-6" />}
          title="No topics yet"
          description="Topics organize questions for this course. Sync them from EduAI Core or create one manually."
          primaryAction={
            canCreateQuestion
              ? {
                  label: 'Sync from Core',
                  icon: <IconRefresh className="size-4" />,
                  onClick: () => void handleSyncFromCore(),
                }
              : undefined
          }
          secondaryAction={
            canCreateQuestion
              ? { label: 'Create topic', onClick: () => setIsCreateOpen(true) }
              : undefined
          }
        />
      ) : (
        <div className="space-y-2">
          {topics.map((topic) => (
            <Card key={topic.id}>
              <CardContent className="py-4">
                <p className="font-medium">{topic.name}</p>
                {topic.description && (
                  <p className="text-sm text-muted-foreground">{topic.description}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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
    </div>
  );
};
