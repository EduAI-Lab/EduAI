/**
 * @file Course-hero topic control — sync/create topics from the course banner.
 *
 * Responsibility: The compact top-right action on the course-detail hero that
 *   manages the course's topic taxonomy (the chips themselves are rendered by
 *   the shared CourseHeroCard's `topics` prop). EduAI-sourced courses get a
 *   one-click re-pull; locally-authored courses get a create-topic dialog.
 *   Orphaned local topics surfaced by a sync are resolved through
 *   TopicSyncMappingDialog.
 * Used by: `app/routes/instructor.course.tsx` (hero `headerAction`).
 * Gotchas:
 *   - Shares the caller's `useCourseTopics` instance so the hero chips and this
 *     control stay in sync after a create/sync.
 *   - Renders nothing when the user lacks `canManageTopics` (chips still show).
 * Related: hooks/useCourseTopics, components/TopicSyncMappingDialog
 */
import { useState } from 'react';
import { IconLoader2, IconPlus, IconRefresh } from '@tabler/icons-react';
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
import TopicSyncMappingDialog from '~/components/TopicSyncMappingDialog';
import { useAtPermissions } from '~/hooks/useAtPermissions';
import type { CourseTopicsState } from '~/hooks/useCourseTopics';
import api from '~/lib/api';
import type { Course } from '~/lib/types';

export function CourseTopicsHeroAction({
  course,
  courseTopics,
}: {
  course: Course;
  courseTopics: CourseTopicsState;
}) {
  const perms = useAtPermissions();
  const { topics } = courseTopics;

  const [syncing, setSyncing] = useState(false);
  const [showMapping, setShowMapping] = useState(false);
  const [missingTopics, setMissingTopics] = useState<{ id: number; name: string }[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const isEduAiCourse = !!course.coreOfferingId;

  if (!perms.canManageTopics) return null;

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await api.syncCourseTopics(course.id);
      // Refresh topics first so the mapping dialog options reflect latest topics.
      await courseTopics.refresh();
      if (result && Array.isArray(result.missingTopics) && result.missingTopics.length > 0) {
        setMissingTopics(result.missingTopics.map((t: any) => ({ id: t.id, name: t.name })));
        setShowMapping(true);
      }
    } catch (e) {
      console.error('Failed to sync topics', e);
      alert('Failed to sync topics from EduAI. Please try again.');
    } finally {
      setSyncing(false);
    }
  };

  const handleCreateTopic = async () => {
    const name = newTopicName.trim();
    if (!name) {
      setCreateError('Topic name cannot be empty.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await courseTopics.createTopic(name);
      setNewTopicName('');
      setCreateOpen(false);
    } catch (e) {
      console.error('Failed to create topic', e);
      setCreateError('Could not create topic. Try a different name.');
    } finally {
      setCreating(false);
    }
  };

  const heroButtonClass =
    'border-white/30 bg-white/15 text-white hover:bg-white/25 hover:text-white backdrop-blur-sm';

  return (
    <>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            {isEduAiCourse ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={heroButtonClass}
                aria-label="Sync topics from EduAI"
                onClick={() => {
                  if (!syncing) void handleSync();
                }}
                disabled={syncing}
              >
                <IconRefresh
                  className={`size-4${syncing ? ' animate-spin' : ''}`}
                  aria-hidden="true"
                />
                {syncing ? 'Syncing…' : 'Sync now'}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={heroButtonClass}
                aria-label="Create topic"
                onClick={() => setCreateOpen(true)}
              >
                <IconPlus className="size-4" aria-hidden="true" />
                Create topic
              </Button>
            )}
          </TooltipTrigger>
          <TooltipContent>
            {isEduAiCourse ? 'Sync topics from EduAI Core' : 'Create a course topic'}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!creating) {
            setCreateOpen(open);
            if (!open) {
              setNewTopicName('');
              setCreateError(null);
            }
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Topic</DialogTitle>
            <DialogDescription>
              Add a new topic to organize this course’s content.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              placeholder="Topic name"
              value={newTopicName}
              onChange={(e) => setNewTopicName(e.target.value)}
              autoFocus
            />
            <Button
              onClick={() => void handleCreateTopic()}
              disabled={creating}
              className="shrink-0"
            >
              {creating && <IconLoader2 className="size-4 animate-spin" aria-hidden="true" />}
              Create
            </Button>
          </div>
          {createError && <p className="text-sm text-destructive">{createError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TopicSyncMappingDialog
        open={showMapping}
        onClose={() => setShowMapping(false)}
        topics={topics}
        missing={missingTopics}
        busy={syncing}
        onApply={async (mappings) => {
          await api.remapCourseTopics(course.id, mappings);
          await courseTopics.refresh();
        }}
      />
    </>
  );
}
