import { IconAlertTriangle, IconLoader2, IconSparkles } from "@tabler/icons-react";
import { Button } from "@eduai/ui";

import type { TopicAnalysisStatus } from "~/hooks/api/use-topic-analysis";

/** Human wording for the extractor that produced a course's topics. */
const SOURCE_LABELS = {
  "canvas-modules": "Canvas modules",
  "material-headings": "chapter headings in your materials",
  ai: "an AI reading of your materials",
  none: "no usable structure",
} satisfies Record<string, string>;

/** Wording for a source the server reported, falling back for an unknown one. */
function sourceLabel(usedSource: string | null): string {
  if (usedSource !== null && usedSource in SOURCE_LABELS) {
    return SOURCE_LABELS[usedSource as keyof typeof SOURCE_LABELS];
  }
  return "your course materials";
}

type TopicAnalysisBannerProps = {
  status: TopicAnalysisStatus;
  onRetry: () => void;
  retrying?: boolean;
};

/**
 * Persistent status for the topic job that runs after uploads (#1624, #1965).
 *
 * Reads the durable AiJob row rather than a toast, so an instructor who kicked
 * off a Canvas sync and closed the tab still finds out what happened. Renders
 * nothing when there has never been a job — a course nobody has synced should
 * not carry a banner about a feature that has not run.
 */
export function TopicAnalysisBanner({ status, onRetry, retrying }: TopicAnalysisBannerProps) {
  const job = status.job;
  if (!job) return null;

  if (job.status === "PENDING" || job.status === "RUNNING") {
    return (
      <Banner tone="muted" icon={<IconLoader2 className="h-4 w-4 animate-spin" />}>
        Filing new materials under this course&rsquo;s topics. You can keep authoring questions
        while this runs.
      </Banner>
    );
  }

  if (job.status === "FAILED") {
    return (
      <Banner
        tone="destructive"
        icon={<IconAlertTriangle className="h-4 w-4" />}
        action={
          <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
            {retrying ? "Retrying…" : "Try again"}
          </Button>
        }
      >
        Filing materials under topics failed{job.errorMessage ? `: ${job.errorMessage}` : "."} Your
        materials were imported normally, and you can still set their topics on the Materials tab.
      </Banner>
    );
  }

  if (job.status !== "COMPLETED") return null;

  if (job.matched !== null) return <MatchSummary matched={job.matched} unmatched={job.unmatched} />;

  const created = job.created ?? 0;
  if (created === 0) {
    return (
      <Banner tone="muted" icon={<IconSparkles className="h-4 w-4" />}>
        No new topics were found in this course&rsquo;s materials.
      </Banner>
    );
  }

  const source = sourceLabel(job.usedSource);

  return (
    <Banner tone="muted" icon={<IconSparkles className="h-4 w-4" />}>
      Suggested {created} {created === 1 ? "topic" : "topics"} from {source}.
      {status.pendingSuggestions > 0
        ? ` ${status.pendingSuggestions} still awaiting your review.`
        : ""}
    </Banner>
  );
}

const files = (count: number) => `${count} ${count === 1 ? "file" : "files"}`;

/**
 * Outcome of filing uploads under the course's existing topics (#1965). Says
 * nothing when there was nothing to file — a course with no topics yet, or a
 * batch whose files all had their topics set by hand.
 */
function MatchSummary({ matched, unmatched }: { matched: number; unmatched: number | null }) {
  const unfiled = unmatched ?? 0;
  if (matched === 0 && unfiled === 0) return null;

  const unfiledNote =
    unfiled > 0
      ? ` ${files(unfiled)} didn't fit any topic. You can set their topics on the Materials tab.`
      : "";

  return (
    <Banner tone="muted" icon={<IconSparkles className="h-4 w-4" />}>
      {matched > 0
        ? `Filed ${files(matched)} under existing topics.${unfiledNote}`
        : unfiledNote.trim()}
    </Banner>
  );
}

function Banner({
  tone,
  icon,
  action,
  children,
}: {
  tone: "muted" | "destructive";
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      className={
        tone === "destructive"
          ? "flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm"
          : "flex items-start gap-3 rounded-md border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground"
      }
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <p className="flex-1 leading-relaxed">{children}</p>
      {action}
    </div>
  );
}
