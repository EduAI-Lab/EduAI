import { useEffect, useState } from "react";
import { AnimatedDiagramShell } from "~/tests/visual/pre1320-components/animated-diagram-shell";
import { useDiagramStageUi } from "~/components/chat/diagrams/diagram-stage-ui";
import type { EduaiDiagramPayload } from "~/lib/ai/eduai-diagram-payload";
import { cn } from "~/lib/utils";

/**
 * Side-by-side compare: two labeled, tappable panes.
 */
export function AnimatedCompare({
  className,
  payload,
}: {
  className?: string;
  payload: EduaiDiagramPayload;
}) {
  const { stages, selected, setSelected, detail } = useDiagramStageUi(
    "compare",
    payload,
  );

  return (
    <AnimatedDiagramShell
      className={className}
      diagramId="compare"
      title={payload.title?.trim() || "Compare"}
      ariaLabel={`Interactive comparison: ${stages.map((s) => s.label).join(" versus ")}`}
      caption="Tap a side for a short explanation."
      detail={detail}
    >
      {({ playKey, reducedMotion }) => (
        <div
          key={playKey}
          className="flex flex-wrap items-stretch justify-center gap-2 sm:gap-3"
        >
          {stages.map((pane, i) => (
            <ComparePane
              key={`${pane.label}-${i}`}
              label={pane.label}
              selected={selected === i}
              delayMs={i * 900}
              onSelect={() => setSelected(i)}
              reducedMotion={reducedMotion}
              playKey={playKey}
            />
          ))}
        </div>
      )}
    </AnimatedDiagramShell>
  );
}

function ComparePane({
  label,
  selected,
  delayMs,
  onSelect,
  reducedMotion,
  playKey,
}: {
  label: string;
  selected: boolean;
  delayMs: number;
  onSelect: () => void;
  reducedMotion: boolean;
  playKey: number;
}) {
  const [pulse, setPulse] = useState(reducedMotion);

  useEffect(() => {
    if (reducedMotion) {
      setPulse(true);
      return;
    }
    setPulse(false);
    const t = window.setTimeout(() => setPulse(true), delayMs);
    return () => window.clearTimeout(t);
  }, [playKey, delayMs, reducedMotion]);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "min-h-[4.5rem] min-w-[7.5rem] max-w-[11rem] flex-1 rounded-xl border px-3 py-3 text-center text-sm font-semibold transition-colors",
        selected
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : pulse
            ? "border-primary/50 bg-primary/10 text-foreground"
            : "border-border bg-background text-foreground hover:border-primary/40",
      )}
    >
      {label}
    </button>
  );
}
