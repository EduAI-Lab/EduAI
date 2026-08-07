/**
 * Shared question-bank analytics panel set: type composition (donut), difficulty
 * mix (stacked bar), authoring/review split (donut + meter), and an optional topic-
 * coverage meter. Single source of truth for both the global QM dashboard and the
 * per-course Overview tab — pass `topicCoverage` to surface the 4th panel.
 *
 * Pure presentational: the caller computes every number. Robust to all-zero data.
 */
import { DonutChart, type DonutSegment } from "./donut-chart"
import { StackedBar } from "./stacked-bar"
import { MeterBar } from "./meter-bar"
import { PanelCard } from "./panel-card"
import { cn } from "../utils"

const AI_COLOR = "var(--color-series-5)"
const HUMAN_COLOR = "var(--color-series-4)"
const REVIEWED_COLOR = "var(--color-series-1)"
const COVERAGE_COLOR = "var(--color-series-3)"

export interface QuestionAnalyticsProps {
  typeComposition: DonutSegment[]
  /** Easy / Medium / Hard segments (label, count, color). Rendered as a stacked bar. */
  difficulty: DonutSegment[]
  totalQuestions: number
  totalVariants: number
  aiCount: number
  humanCount: number
  reviewedCount: number
  /** Omit to hide the topic-coverage panel (e.g. the global, multi-course dashboard). */
  topicCoverage?: { covered: number; total: number }
  className?: string
}

export function QuestionAnalytics({
  typeComposition,
  difficulty,
  totalQuestions,
  totalVariants,
  aiCount,
  humanCount,
  reviewedCount,
  topicCoverage,
  className,
}: QuestionAnalyticsProps) {
  const hasCoverage = topicCoverage !== undefined

  return (
    <div className={cn("grid gap-4", hasCoverage ? "md:grid-cols-2" : "md:grid-cols-3", className)}>
      <PanelCard title="Question types">
        <DonutChart data={typeComposition} centerValue={totalQuestions} centerLabel="Questions" />
      </PanelCard>

      <PanelCard title="Difficulty mix">
        <StackedBar data={difficulty} />
      </PanelCard>

      <PanelCard title="Authoring & review">
        <DonutChart
          size={108}
          thickness={16}
          data={[
            { label: "AI-generated", value: aiCount, color: AI_COLOR },
            { label: "Human-written", value: humanCount, color: HUMAN_COLOR },
          ]}
        />
        <div className="mt-4">
          <MeterBar label="Reviewed" value={reviewedCount} total={totalVariants} color={REVIEWED_COLOR} showCount />
        </div>
      </PanelCard>

      {hasCoverage && (
        <PanelCard title="Topic coverage">
          <div className="flex flex-col gap-2 pt-1">
            <MeterBar
              label="Topics with questions"
              value={topicCoverage.covered}
              total={topicCoverage.total}
              color={COVERAGE_COLOR}
              showCount
            />
            <p className="text-xs text-muted-foreground">
              {topicCoverage.total === 0
                ? "No topics synced yet — sync from Core on the Topics tab."
                : topicCoverage.covered === topicCoverage.total
                  ? "Every topic has at least one question. Nice coverage."
                  : `${topicCoverage.total - topicCoverage.covered} topic${
                      topicCoverage.total - topicCoverage.covered === 1 ? "" : "s"
                    } still need questions.`}
            </p>
          </div>
        </PanelCard>
      )}
    </div>
  )
}
