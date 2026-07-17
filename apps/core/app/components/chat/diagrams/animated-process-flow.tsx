import { useEffect, useState } from "react";
import { AnimatedDiagramShell } from "~/components/chat/diagrams/animated-diagram-shell";
import {
  defaultStagesForType,
  normalizeStagesForType,
  type EduaiDiagramPayload,
} from "~/lib/ai/eduai-diagram-payload";
import { cn } from "~/lib/utils";

/**
 * Topic-specific process flow: labeled, tappable stages with a detail panel.
 */
export function AnimatedProcessFlow({
  className,
  payload,
}: {
  className?: string;
  payload: EduaiDiagramPayload;
}) {
  const stages = normalizeStagesForType(
    "process-flow",
    payload.stages.length > 0
      ? payload.stages
      : defaultStagesForType("process-flow"),
  );
  const [selected, setSelected] = useState(0);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    setSelected(0);
    setHighlight(0);
  }, [payload.title, stages.map((s) => s.label).join("|")]);

  return (
    <AnimatedDiagramShell
      className={className}
      diagramId="process-flow"
      title={payload.title?.trim() || "Process flow"}
      ariaLabel={`Interactive process flow: ${stages.map((s) => s.label).join(", ")}`}
      caption="Tap a stage for a short explanation."
      detail={
        <>
          <span className="font-medium">{stages[selected]?.label}</span>
          {stages[selected]?.detail ? (
            <span className="text-muted-foreground">
              {" — "}
              {stages[selected]?.detail}
            </span>
          ) : null}
        </>
      }
    >
      {({ playKey, reducedMotion }) => (
        <ProcessFlowTrack
          key={playKey}
          stages={stages}
          selected={selected}
          highlight={reducedMotion ? selected : highlight}
          reducedMotion={reducedMotion}
          onSelect={setSelected}
          onHighlight={setHighlight}
          playKey={playKey}
        />
      )}
    </AnimatedDiagramShell>
  );
}

function ProcessFlowTrack({
  stages,
  selected,
  highlight,
  reducedMotion,
  onSelect,
  onHighlight,
  playKey,
}: {
  stages: { label: string; detail: string }[];
  selected: number;
  highlight: number;
  reducedMotion: boolean;
  onSelect: (i: number) => void;
  onHighlight: (i: number) => void;
  playKey: number;
}) {
  useEffect(() => {
    if (reducedMotion) return;
    onHighlight(0);
    const timers: number[] = [];
    stages.forEach((_, i) => {
      timers.push(
        window.setTimeout(() => {
          onHighlight(i);
          onSelect(i);
        }, i * 700),
      );
    });
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [playKey, reducedMotion, stages.length, onHighlight, onSelect]);

  return (
    <ol className="flex flex-wrap items-stretch justify-center gap-1.5 sm:gap-2">
      {stages.map((stage, i) => {
        const isSelected = selected === i;
        const isLit = highlight === i;
        return (
          <li key={`${stage.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
            {i > 0 ? (
              <span
                aria-hidden
                className="hidden text-muted-foreground/50 sm:inline"
              >
                →
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-pressed={isSelected}
              className={cn(
                "min-h-11 min-w-[4.5rem] max-w-[7.5rem] flex-1 rounded-lg border px-2 py-2 text-center text-[11px] font-medium leading-snug transition-colors sm:text-xs",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : isLit
                    ? "border-primary/60 bg-primary/15 text-foreground"
                    : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-muted/60",
              )}
            >
              {stage.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
