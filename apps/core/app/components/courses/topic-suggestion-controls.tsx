import { IconCheck, IconGitMerge, IconX } from "@tabler/icons-react";
import { useState } from "react";
import {
  Badge,
  Button,
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

  const confidence =
    typeof topic.confidence === "number" ? ` · ${Math.round(topic.confidence * 100)}%` : "";

  return (
    <Badge variant={origin === "AI" ? "outline" : "secondary"} className="font-normal">
      {ORIGIN_LABELS[origin]}
      {confidence}
    </Badge>
  );
}

type TopicSuggestionControlsProps = {
  topic: CourseTopic;
  /** Topics this suggestion may be folded into — never itself. */
  mergeTargets: CourseTopic[];
  onApprove: (topicId: string) => Promise<void>;
  onDismiss: (topicId: string) => Promise<void>;
  onMerge: (topicId: string, intoTopicId: string) => Promise<void>;
};

/**
 * Approve / merge / dismiss controls for one unreviewed suggestion (#1624).
 *
 * Rename is deliberately absent: topics already have an edit path, and
 * duplicating it here would mean two places to keep correct. Approving a
 * suggestion simply promotes it, after which the normal controls apply.
 */
export function TopicSuggestionControls({
  topic,
  mergeTargets,
  onApprove,
  onDismiss,
  onMerge,
}: TopicSuggestionControlsProps) {
  const [busy, setBusy] = useState(false);
  const [mergeInto, setMergeInto] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

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
