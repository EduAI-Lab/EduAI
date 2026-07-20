/**
 * @file Course-hero topic control — create topics from the course banner.
 *
 * Responsibility: The compact top-right action on the course-detail hero that
 *   manages the course's topic taxonomy (the chips themselves are rendered by
 *   the shared CourseHeroCard's `topics` prop). EduAI-sourced courses have
 *   their topics pulled automatically from Core (see server routes/topics.js);
 *   locally-authored courses get a create-topic dialog here.
 * Used by: `app/routes/instructor.course.tsx` (hero `headerAction`).
 * Gotchas:
 *   - Shares the caller's `useCourseTopics` instance so the hero chips and this
 *     control stay in sync after a create.
 *   - Renders nothing when the user lacks `canManageTopics` (chips still show),
 *     or for EduAI-sourced courses (no manual action needed — see #1031).
 * Related: hooks/useCourseTopics
 */
import { useState } from 'react';
import { IconLoader2, IconPlus } from '@tabler/icons-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@eduai/ui';
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

  const [createOpen, setCreateOpen] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // EduAI-sourced courses have their topics pulled automatically from Core
  // on every read (routes/topics.js) — no manual action needed here. Gated
  // on `coreOfferingId` to match the server's sync/create gate exactly
  // (routes/topics.js checks `course.coreOfferingId`); every CourseOffering
  // is now a Core anchor row (#1072), so this is effectively always true —
  // the field stays optional here only defensively.
  const isEduAiCourse = !!course.coreOfferingId;
  if (!perms.canManageTopics || isEduAiCourse) return null;

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
    </>
  );
}
