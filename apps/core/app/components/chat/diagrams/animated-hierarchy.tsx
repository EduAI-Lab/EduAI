import { useEffect, useState } from "react";
import { AnimatedDiagramShell } from "~/components/chat/diagrams/animated-diagram-shell";
import {
  defaultStagesForType,
  normalizeStagesForType,
  type EduaiDiagramPayload,
} from "~/lib/ai/eduai-diagram-payload";
import { cn } from "~/lib/utils";

/**
 * Hierarchy / tree: root then children — labeled and tappable.
 */
export function AnimatedHierarchy({
  className,
  payload,
}: {
  className?: string;
  payload: EduaiDiagramPayload;
}) {
  const stages = normalizeStagesForType(
    "hierarchy",
    payload.stages.length > 0
      ? payload.stages
      : defaultStagesForType("hierarchy"),
  );
  const root = stages[0]!;
  const children = stages.slice(1);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    setSelected(0);
  }, [payload.title, stages.map((s) => s.label).join("|")]);

  return (
    <AnimatedDiagramShell
      className={className}
      diagramId="hierarchy"
      title={payload.title?.trim() || "Structure / hierarchy"}
      ariaLabel={`Interactive hierarchy: ${stages.map((s) => s.label).join(", ")}`}
      caption="Tap a node for a short explanation."
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
        <div key={playKey} className="flex flex-col items-center gap-3 py-1">
          <HierarchyNode
            label={root.label}
            selected={selected === 0}
            lit={!reducedMotion}
            delayMs={0}
            onSelect={() => setSelected(0)}
            reducedMotion={reducedMotion}
            playKey={playKey}
          />
          {children.length > 0 ? (
            <div className="flex flex-wrap items-stretch justify-center gap-2">
              {children.map((child, i) => (
                <HierarchyNode
                  key={`${child.label}-${i}`}
                  label={child.label}
                  selected={selected === i + 1}
                  lit={!reducedMotion}
                  delayMs={(i + 1) * 450}
                  onSelect={() => setSelected(i + 1)}
                  reducedMotion={reducedMotion}
                  playKey={playKey}
                />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </AnimatedDiagramShell>
  );
}

function HierarchyNode({
  label,
  selected,
  lit,
  delayMs,
  onSelect,
  reducedMotion,
  playKey,
}: {
  label: string;
  selected: boolean;
  lit: boolean;
  delayMs: number;
  onSelect: () => void;
  reducedMotion: boolean;
  playKey: number;
}) {
  const [visible, setVisible] = useState(reducedMotion);

  useEffect(() => {
    if (reducedMotion) {
      setVisible(true);
      return;
    }
    setVisible(false);
    const t = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(t);
  }, [playKey, delayMs, reducedMotion]);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "min-h-11 min-w-[5.5rem] max-w-[9rem] rounded-full border px-3 py-2 text-center text-[11px] font-medium leading-snug transition-all sm:text-xs",
        selected
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "border-border bg-background text-foreground hover:border-primary/40",
        visible || !lit ? "opacity-100 scale-100" : "opacity-0 scale-95",
      )}
    >
      {label}
    </button>
  );
}
