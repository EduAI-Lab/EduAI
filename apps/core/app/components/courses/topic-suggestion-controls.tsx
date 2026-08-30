import { IconCheck, IconGitMerge, IconPencil, IconX } from "@tabler/icons-react";
import { useState } from "react";
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@eduai/ui";

import type { CourseTopic, TopicOrigin } from "~/hooks/api/use-course-topics";

/** What each provenance means in instructor-facing words. */
const ORIGIN_LABELS = {
  HUMAN: "Added by hand",
  SYSTEM: "Default",
  CANVAS_MODULE: "From Canvas module",
  MATERIAL_HEADING: "From a chapter heading",
  AI: "Suggested by AI",
} satisfies Record<TopicOrigin, string>;

/** Whether this topic is an unreviewed machine-generated suggestion. */
export function isSuggestion(topic: CourseTopic): boolean {
  return topic.reviewStatus === "SUGGESTED";
}

/**
 * Provenance badge for a topic (#1624).
 *
 * Shown only for topics that were not typed by a person: labelling an
 * instructor's own topic "Added by hand" is noise, and the whole point of the
 * badge is to mark the ones whose names a machine chose.
 */
export function TopicOriginBadge({ topic }: { topic: CourseTopic }) {
  const origin = topic.origin;
  if (!origin || origin === "HUMAN") return null;

  const confidence = Number.isFinite(topic.confidence)
    ? ` · ${Math.round(topic.confidence * 100)}%`
    : "";

  return (
    <Badge variant={origin === "AI" ? "outline" : "secondary"} className="font-normal">
      {ORIGIN_LABELS[origin]}
      {confidence}
    </Badge>
  );
}

/**
 * The materials a generated topic was derived from (#1624).
 *
 * A reviewer deciding whether to keep a name needs to know what produced it —
 * "From a chapter heading" alone does not say which reading it came out of. The
 * projection is capped server-side, so an overflow is reported rather than
 * silently dropped.
 */
export function TopicSourceList({ topic }: { topic: CourseTopic }) {
  const sources = topic.sources ?? [];
  if (sources.length === 0) return null;

  const total = topic.sourceCount ?? sources.length;
  const overflow = total - sources.length;
  const names = sources.map((source) => source.title ?? "Untitled material");

  return (
    <p className="text-xs text-muted-foreground">
      From {names.join(", ")}
      {overflow > 0 ? ` and ${overflow} more` : ""}
    </p>
  );
}

type TopicSuggestionControlsProps = {
  topic: CourseTopic;
  /** Topics this suggestion may be folded into — never itself. */
  mergeTargets: CourseTopic[];
  onApprove: (topicId: string) => Promise<void>;
  onDismiss: (topicId: string) => Promise<void>;
  onMerge: (topicId: string, intoTopicId: string) => Promise<void>;
  /** Omitted by a caller with no rename path; the affordance is then not shown. */
  onRename?: (topicId: string, name: string) => Promise<void>;
};

/**
 * Approve / rename / merge / dismiss controls for one unreviewed suggestion (#1624).
 *
 * Rename is here rather than only on an approved topic because a reviewer's most
 * common correction is a wording fix on a machine-chosen name, and making them
 * approve first — turning a name they disagree with into an accepted one — gets
 * the order backwards. It writes through the same
 * `PATCH /api/courses/:courseId/topics/:topicId` the rest of the manager uses.
 */
export function TopicSuggestionControls({
  topic,
  mergeTargets,
  onApprove,
  onDismiss,
  onMerge,
  onRename,
}: TopicSuggestionControlsProps) {
  const [busy, setBusy] = useState(false);
  const [mergeInto, setMergeInto] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(topic.name);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const candidates = mergeTargets.filter((candidate) => candidate.id !== topic.id);

  const submitRename = async () => {
    const name = draftName.trim();
    // An unchanged or emptied name is a cancel, not a request: nothing to write.
    if (!name || name === topic.name || !onRename) {
      setRenaming(false);
      setDraftName(topic.name);
      return;
    }
    await run(async () => {
      await onRename(topic.id, name);
      setRenaming(false);
    });
  };

  if (renaming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void submitRename();
          }}
        >
          <Input
            autoFocus
            value={draftName}
            aria-label={`Rename ${topic.name}`}
            className="h-8 w-48 text-xs"
            disabled={busy}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              setRenaming(false);
              setDraftName(topic.name);
            }}
          />
          <Button type="submit" size="sm" className="h-8" disabled={busy}>
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8"
            disabled={busy}
            onClick={() => {
              setRenaming(false);
              setDraftName(topic.name);
            }}
          >
            Cancel
          </Button>
        </form>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        {candidates.length > 0 && (
          <>
            <Select value={mergeInto} onValueChange={setMergeInto}>
              <SelectTrigger
                className="h-8 w-40 text-xs"
                aria-label={`Merge ${topic.name} into another topic`}
              >
                <SelectValue placeholder="Merge into…" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Merge ${topic.name}`}
              disabled={busy || !mergeInto}
              onClick={() => run(() => onMerge(topic.id, mergeInto))}
            >
              <IconGitMerge className="h-4 w-4" />
            </Button>
          </>
        )}
        {onRename && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Rename ${topic.name}`}
            disabled={busy}
            onClick={() => {
              setDraftName(topic.name);
              setError(null);
              setRenaming(true);
            }}
          >
            <IconPencil className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Approve ${topic.name}`}
          disabled={busy}
          onClick={() => run(() => onApprove(topic.id))}
        >
          <IconCheck className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Dismiss ${topic.name}`}
          className="text-destructive hover:text-destructive"
          disabled={busy}
          onClick={() => run(() => onDismiss(topic.id))}
        >
          <IconX className="h-4 w-4" />
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
