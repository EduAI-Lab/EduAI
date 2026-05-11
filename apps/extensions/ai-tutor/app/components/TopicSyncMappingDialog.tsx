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
 * Related: `server/src/routes/topics.js`, `app/lib/api.ts` (syncTopics, remapTopics)
 */

import { useMemo, useState } from 'react';
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[min(720px,95vw)] rounded-2xl bg-white dark:bg-gray-950 p-6 shadow-xl border border-gray-200 dark:border-gray-800">
        <div className="text-lg font-semibold">Review topic changes</div>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Some topics in this course are no longer present in EduAI. Please map them to existing
          topics so activities remain correctly tagged.
        </p>

        <div className="mt-4 space-y-3 max-h-[50vh] overflow-y-auto pr-1">
          {missing.map((m) => (
            <div key={m.id} className="rounded-xl border border-gray-200 dark:border-gray-800 p-3">
              <div className="text-sm">
                <span className="font-semibold">{m.name}</span> no longer exists. Choose a
                replacement topic:
              </div>
              <div className="mt-2">
                <select
                  className="w-full sm:w-80 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent"
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

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-sm"
            disabled={submitting || busy}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!allSelected || submitting || busy}
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50"
          >
            {submitting ? 'Applying…' : 'Apply mappings'}
          </button>
        </div>
      </div>
    </div>
  );
}
