import { useEffect, useState } from "react";
import { AnimatedDiagramShell } from "~/components/chat/diagrams/animated-diagram-shell";
import { useDiagramStageUi } from "~/components/chat/diagrams/diagram-stage-ui";
import type { EduaiDiagramPayload } from "~/lib/ai/eduai-diagram-payload";
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
  const { stages, selected, setSelected, detail } = useDiagramStageUi(
    "hierarchy",
    payload,
  );
  const root = stages[0] ?? { label: "Whole", detail: "" };
  const children = stages.slice(1);

  return (
    <AnimatedDiagramShell
      className={className}
      diagramId="hierarchy"
      title={payload.title?.trim() || "Structure / hierarchy"}
      ariaLabel={`Interactive hierarchy: ${stages.map((s) => s.label).join(", ")}`}
      caption="Tap a node for a short explanation."
      detail={detail}
    >
      {({ playKey, reducedMotion }) => (
        <div key={playKey} className="flex flex-col items-center gap-3 py-1">
          <HierarchyNode
            label={root.label}
            selected={selected === 0}
            delayMs={0}
            onSelect={() => setSelected(0)}
            reducedMotion={reducedMotion}
            playKey={playKey}
          />
          {children.length > 0 ? (
            <div className="flex w-full min-w-0 flex-wrap items-stretch justify-center gap-2">
              {children.map((child, i) => (
                <HierarchyNode
                  key={`${child.label}-${i}`}
                  label={child.label}
                  selected={selected === i + 1}
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
        visible ? "opacity-100 scale-100" : "opacity-0 scale-95",
      )}
    >
      {label}
    </button>
  );
}
