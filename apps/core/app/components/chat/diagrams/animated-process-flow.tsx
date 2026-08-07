import { useEffect, useState } from "react";
import { AnimatedDiagramShell } from "~/components/chat/diagrams/animated-diagram-shell";
import {
  StageChipButton,
  diagramStageResetKey,
  useDiagramStageUi,
} from "~/components/chat/diagrams/diagram-stage-ui";
import type { EduaiDiagramPayload } from "~/lib/ai/eduai-diagram-payload";

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
  const { stages, selected, setSelected, detail } = useDiagramStageUi(
    "process-flow",
    payload,
  );
  const [highlight, setHighlight] = useState(0);
  const stageKey = diagramStageResetKey(payload.title, stages);

  useEffect(() => {
    setHighlight(0);
  }, [stageKey]);

  return (
    <AnimatedDiagramShell
      className={className}
      diagramId="process-flow"
      title={payload.title?.trim() || "Process flow"}
      ariaLabel={`Interactive process flow: ${stages.map((s) => s.label).join(", ")}`}
      caption="Tap a stage for a short explanation."
      detail={detail}
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
  // Autoplay only drives highlight — never selected — so taps stay sticky.
  useEffect(() => {
    if (reducedMotion) return;
    onHighlight(0);
    const timers: number[] = [];
    stages.forEach((_, i) => {
      timers.push(
        window.setTimeout(() => {
          onHighlight(i);
        }, i * 700),
      );
    });
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [playKey, reducedMotion, stages.length, onHighlight]);

  return (
    <ol className="flex w-full min-w-0 flex-wrap items-stretch justify-center gap-1.5 sm:gap-2">
      {stages.map((stage, i) => (
        <li key={`${stage.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
          {i > 0 ? (
            <span
              aria-hidden
              className="hidden text-muted-foreground/50 sm:inline"
            >
              →
            </span>
          ) : null}
          <StageChipButton
            label={stage.label}
            selected={selected === i}
            lit={highlight === i}
            onSelect={() => onSelect(i)}
          />
        </li>
      ))}
    </ol>
  );
}
