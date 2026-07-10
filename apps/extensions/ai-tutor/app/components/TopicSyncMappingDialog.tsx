/**
 * @file Modal that resolves topic drift after an EduAI topic-sync.
 *
 * Responsibility: When upstream EduAI removes topics that local activities
 *   still reference, this dialog asks the instructor to map each missing
 *   topic to a still-existing one so activity tags stay valid.
 * Used by: `app/routes/instructor.course.tsx` (and any other place that
 *   triggers a topics sync). Opened with the `missingTopics` payload that
 *   the sync endpoint returns.
 * Gotchas:
 *   - `toTopicId` is held as a string in local state (`Mapping`) because the
 *     native <select> emits strings; it's coerced to number only when the
 *     payload is built for `onApply`.
 *   - Apply is disabled until every missing row has a replacement, mirroring
 *     the server-side requirement that `/topics/remap` receive a complete
 *     mapping for the provided missing list.
 *   - The dialog is the user-facing half of the sync flow; the server-side
 *     remap logic lives in `server/src/routes/topics.js`.
 *   - Dismissal (Escape / backdrop / the DS close button) is blocked while a
 *     request is in flight (`submitting || busy`), matching the old
 *     hand-rolled modal's disabled-Cancel-while-busy guard.
 * Related: `server/src/routes/topics.js`, `app/lib/api.ts` (syncTopics, remapTopics)
 */

import { useMemo, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@eduai/ui';
import type { Topic } from '~/lib/types';

type MissingTopic = { id: number; name: string };

type Mapping = { fromTopicId: number; toTopicId: string };

/**
 * Renders the remap form. The parent passes `missing` (from the sync
 * response) and an `onApply` that POSTs the chosen mappings; this component
 * just manages selection state and validation.
 */
export default function TopicSyncMappingDialog({
  open,
  onClose,
  topics,
  missing,
  onApply,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  topics: Topic[];
  missing: MissingTopic[];
  onApply: (mappings: { fromTopicId: number; toTopicId: number }[]) => Promise<void>;
  busy?: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [mappings, setMappings] = useState<Mapping[]>(() =>
    missing.map((m) => ({ fromTopicId: m.id, toTopicId: '' })),
  );

  // Reset mapping rows when missing list changes or dialog reopens
  const prevOpen = useMemo(() => open, [open]);
  if (prevOpen && mappings.length !== missing.length) {
    // Ensure we have one mapping per missing topic
    const byFrom = new Map(mappings.map((m) => [m.fromTopicId, m.toTopicId]));
    setMappings(missing.map((m) => ({ fromTopicId: m.id, toTopicId: byFrom.get(m.id) ?? '' })));
  }

  // Keep mappings in sync when missing changes
  const missingIds = useMemo(() => new Set(missing.map((m) => m.id)), [missing]);
  const mappingByFrom = useMemo(() => {
    const map = new Map<number, string>();
    for (const m of mappings) map.set(m.fromTopicId, m.toTopicId);
    return map;
  }, [mappings]);

  const options = useMemo(() => topics, [topics]);

  const allSelected = mappings.length > 0 && mappings.every((m) => m.toTopicId !== '');

  const handleChange = (fromTopicId: number, value: string) => {
    const toTopicId = value || '';
    setMappings((prev) =>
      prev.map((m) => (m.fromTopicId === fromTopicId ? { ...m, toTopicId } : m)),
    );
  };

  const onSubmit = async () => {
    if (!allSelected || submitting || busy) return;
    setSubmitting(true);
    try {
      const payload = mappings
        .filter((m) => m.toTopicId !== '')
        .map((m) => ({ fromTopicId: m.fromTopicId, toTopicId: Number(m.toTopicId) }));
      await onApply(payload);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const busyNow = submitting || busy;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          if (busyNow) return;
          onClose();
        }
      }}
    >
      <DialogContent
        className="sm:max-w-xl"
        onInteractOutside={(event) => {
          if (busyNow) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (busyNow) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Review topic changes</DialogTitle>
          <DialogDescription>
            Some topics in this course are no longer present in EduAI. Please map them to existing
            topics so activities remain correctly tagged.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
          {missing.map((m) => (
            <div key={m.id} className="rounded-[var(--radius-lg)] border border-border p-3">
              <div className="text-sm text-foreground">
                <span className="font-semibold">{m.name}</span> no longer exists. Choose a
                replacement topic:
              </div>
              <div className="mt-2">
                <select
                  className="flex h-9 w-full rounded-[var(--radius-md)] border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-150 ease-in-out focus-visible:border-ring focus-visible:shadow-[var(--shadow-focus)] sm:w-80"
                  value={mappingByFrom.get(m.id) ?? ''}
                  onChange={(e) => handleChange(m.id, e.target.value)}
                >
                  <option value="">Select replacement…</option>
                  {options
                    .filter((t) => t.id !== m.id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busyNow}>
            Cancel
          </Button>
          <Button type="button" onClick={onSubmit} disabled={!allSelected || busyNow}>
            {submitting ? 'Applying…' : 'Apply mappings'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
