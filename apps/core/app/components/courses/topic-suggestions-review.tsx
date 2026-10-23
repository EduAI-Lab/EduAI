import { IconSparkles } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@eduai/ui";

import {
  TopicOriginBadge,
  TopicSourceList,
  TopicSuggestionControls,
} from "~/components/courses/topic-suggestion-controls";
import type { CourseTopic } from "~/hooks/api/use-course-topics";

type TopicSuggestionsReviewProps = {
  /** The course's unreviewed suggestions. */
  suggestions: CourseTopic[];
  /** Accepted topics a suggestion may be merged into. */
  mergeTargets: CourseTopic[];
  onApprove: (topicId: string) => Promise<void>;
  onDismiss: (topicId: string) => Promise<void>;
  onMerge: (topicId: string, intoTopicId: string) => Promise<void>;
  onRename?: (topicId: string, name: string) => Promise<void>;
  /** Bumped by the caller to open the window, e.g. when Suggest topics finishes. */
  openRequest?: number;
};

/**
 * Topic suggestions in their own review window (#1998), apart from the
 * course's approved topics, so it is clear what the AI proposed and what the
 * instructor decided. Each suggestion keeps its approve / rename / merge /
 * dismiss controls; the window closes by itself once none are left.
 */
export function TopicSuggestionsReview({
  suggestions,
  mergeTargets,
  onApprove,
  onDismiss,
  onMerge,
  onRename,
  openRequest = 0,
}: TopicSuggestionsReviewProps) {
  const [open, setOpen] = useState(false);
  const count = suggestions.length;

  useEffect(() => {
    if (openRequest > 0 && count > 0) setOpen(true);
    // Only a new request opens it; the count changing as suggestions are
    // reviewed must not reopen a window the instructor closed.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  useEffect(() => {
    if (count === 0) setOpen(false);
  }, [count]);

  if (count === 0) return null;

  return (
    <>
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
          <p className="flex items-center gap-2 text-sm">
            <IconSparkles className="h-4 w-4 text-primary" aria-hidden />
            {count} {count === 1 ? "topic suggestion" : "topic suggestions"} to review. Students
            don't see a suggestion until you approve it.
          </p>
          <Button size="sm" onClick={() => setOpen(true)}>
            Review suggestions
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review topic suggestions</DialogTitle>
            <DialogDescription>
              Approve a suggestion to add it to your topics, rename it first, merge it into a topic
              you have, or dismiss it so it isn't suggested again.
            </DialogDescription>
          </DialogHeader>
          <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto overscroll-contain">
            {suggestions.map((topic) => (
              <li
                key={topic.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              >
                <span className="flex min-w-0 flex-col gap-0.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{topic.name}</span>
                    <TopicOriginBadge topic={topic} />
                  </span>
                  <TopicSourceList topic={topic} />
                </span>
                <TopicSuggestionControls
                  topic={topic}
                  mergeTargets={mergeTargets}
                  onApprove={onApprove}
                  onDismiss={onDismiss}
                  onMerge={onMerge}
                  onRename={onRename}
                />
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
