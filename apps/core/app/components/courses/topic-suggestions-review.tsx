import { IconSparkles } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  ConfirmDialog,
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
import type { TopicBatchReviewResult } from "~/hooks/api/use-topic-analysis";

type BatchAction = "approve" | "dismiss";

/** Why a topic in a batch was not acted on, in instructor-facing words. */
const BATCH_FAILURE_REASONS = new Map([
  ["TOPIC_NOT_FOUND", "already reviewed or removed"],
  ["TOPIC_HAS_QUESTIONS", "it has questions, so merge it instead"],
]);

function plural(count: number) {
  return count === 1 ? "suggestion" : "suggestions";
}

/** One line naming each topic a batch could not act on, and why. */
function describeFailures(
  action: BatchAction,
  failed: TopicBatchReviewResult["failed"],
  names: Map<string, string>,
) {
  const items = failed.map(({ topicId, error }) => {
    const reason = BATCH_FAILURE_REASONS.get(error) ?? "something went wrong";
    return `${names.get(topicId) ?? "Unknown topic"} (${reason})`;
  });
  return `Couldn't ${action} ${failed.length} ${plural(failed.length)}: ${items.join(", ")}.`;
}

type TopicSuggestionsReviewProps = {
  /** The course's unreviewed suggestions. */
  suggestions: CourseTopic[];
  /** Accepted topics a suggestion may be merged into. */
  mergeTargets: CourseTopic[];
  onApprove: (topicId: string) => Promise<void>;
  onDismiss: (topicId: string) => Promise<void>;
  onMerge: (topicId: string, intoTopicId: string) => Promise<void>;
  onRename?: (topicId: string, name: string) => Promise<void>;
  /**
   * Approve or dismiss a selection in one request (#1977). Without both, the
   * window offers per-suggestion review only.
   */
  onApproveMany?: (topicIds: string[]) => Promise<TopicBatchReviewResult>;
  onDismissMany?: (topicIds: string[]) => Promise<TopicBatchReviewResult>;
  /** Bumped by the caller to open the window, e.g. when Suggest topics finishes. */
  openRequest?: number;
};

/**
 * Topic suggestions in their own review window (#1998), apart from the
 * course's approved topics, so it is clear what the AI proposed and what the
 * instructor decided. Each suggestion keeps its approve / rename / merge /
 * dismiss controls; the window closes by itself once none are left.
 *
 * #1977: suggestions can also be selected and approved or dismissed together,
 * behind a confirmation. Topics the batch could not act on are named afterwards.
 */
export function TopicSuggestionsReview({
  suggestions,
  mergeTargets,
  onApprove,
  onDismiss,
  onMerge,
  onRename,
  onApproveMany,
  onDismissMany,
  openRequest = 0,
}: TopicSuggestionsReviewProps) {
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState<BatchAction | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const count = suggestions.length;
  const canBatch = Boolean(onApproveMany && onDismissMany);

  // Derived rather than pruned in an effect: a suggestion reviewed one at a
  // time drops out of the selection as soon as it leaves the list.
  const selected = suggestions.filter((topic) => selectedIds.has(topic.id));
  const allSelected = count > 0 && selected.length === count;

  const toggle = (topicId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(topicId);
      else next.delete(topicId);
      return next;
    });
  };

  const runBatch = async (action: BatchAction) => {
    const run = action === "approve" ? onApproveMany : onDismissMany;
    if (!run || selected.length === 0) return;
    // Captured first: a topic the batch acted on is gone from `suggestions` by
    // the time the failures are described.
    const names = new Map(selected.map((topic) => [topic.id, topic.name]));
    setBatchBusy(true);
    setBatchError(null);
    try {
      const result = await run([...names.keys()]);
      setSelectedIds(new Set());
      if (result.failed.length > 0) {
        setBatchError(describeFailures(action, result.failed, names));
      }
    } catch (cause) {
      setBatchError(cause instanceof Error ? cause.message : "Action failed");
    } finally {
      setBatchBusy(false);
      setConfirming(null);
    }
  };

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
          {canBatch && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={allSelected || (selected.length > 0 && "indeterminate")}
                  onCheckedChange={(value) =>
                    setSelectedIds(
                      value === true ? new Set(suggestions.map((topic) => topic.id)) : new Set(),
                    )
                  }
                  aria-label="Select all suggestions"
                  disabled={batchBusy}
                />
                {selected.length > 0 ? `${selected.length} selected` : "Select all"}
              </label>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  disabled={batchBusy || selected.length === 0}
                  onClick={() => setConfirming("dismiss")}
                >
                  Dismiss selected
                </Button>
                <Button
                  size="sm"
                  disabled={batchBusy || selected.length === 0}
                  onClick={() => setConfirming("approve")}
                >
                  Approve selected
                </Button>
              </div>
            </div>
          )}
          {batchError && (
            <p role="alert" className="text-sm text-destructive">
              {batchError}
            </p>
          )}
          <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto overscroll-contain">
            {suggestions.map((topic) => (
              <li
                key={topic.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              >
                {canBatch && (
                  <Checkbox
                    checked={selectedIds.has(topic.id)}
                    onCheckedChange={(value) => toggle(topic.id, value === true)}
                    aria-label={`Select ${topic.name}`}
                    disabled={batchBusy}
                  />
                )}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
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

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next && !batchBusy) setConfirming(null);
        }}
        title={
          confirming === "approve"
            ? `Approve ${selected.length} ${plural(selected.length)}?`
            : `Dismiss ${selected.length} ${plural(selected.length)}?`
        }
        description={
          confirming === "approve"
            ? "They become course topics, and students can see them."
            : "They are removed and won't be suggested again."
        }
        confirmLabel={confirming === "approve" ? "Approve" : "Dismiss"}
        variant={confirming === "approve" ? "default" : "destructive"}
        isLoading={batchBusy}
        closeOnConfirm={false}
        onConfirm={() => {
          if (confirming) void runBatch(confirming);
        }}
      />
    </>
  );
}
