/**
 * Shared stage selection + detail/chip UI for eduai-diagram widgets.
 */

import { useEffect, useState, type ReactNode } from "react";
import {
  defaultStagesForType,
  normalizeStagesForType,
  type EduaiDiagramPayload,
  type EduaiDiagramStage,
} from "~/lib/ai/eduai-diagram-payload";
import type { EduaiDiagramCanonicalId } from "~/lib/ai/eduai-diagram-type";
import { cn } from "~/lib/utils";

/** Resolve normalized stages for a catalog type from a payload. */
export function resolveDiagramStages(
  typeId: EduaiDiagramCanonicalId,
  payload: EduaiDiagramPayload,
): EduaiDiagramStage[] {
  return normalizeStagesForType(
    typeId,
    payload.stages.length > 0
      ? payload.stages
      : defaultStagesForType(typeId),
  );
}

/** Stable key for resetting selection when labels/title change. */
export function diagramStageResetKey(
  title: string | undefined,
  stages: EduaiDiagramStage[],
): string {
  return `${title ?? ""}\0${stages.map((s) => s.label).join("|")}`;
}

export function useDiagramStageSelection(
  stages: EduaiDiagramStage[],
  resetKey: string,
): {
  selected: number;
  setSelected: (index: number) => void;
  selectedStage: EduaiDiagramStage | undefined;
} {
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    setSelected(0);
  }, [resetKey]);

  const clamped =
    stages.length === 0 ? 0 : Math.min(selected, stages.length - 1);

  return {
    selected: clamped,
    setSelected,
    selectedStage: stages[clamped],
  };
}

export function DiagramStageDetail({
  stage,
}: {
  stage: EduaiDiagramStage | undefined;
}): ReactNode {
  if (!stage) return null;
  return (
    <>
      <span className="font-medium">{stage.label}</span>
      {stage.detail ? (
        <span className="text-muted-foreground">
          {" — "}
          {stage.detail}
        </span>
      ) : null}
    </>
  );
}

export function StageChipButton({
  label,
  selected,
  lit = false,
  onSelect,
  className,
}: {
  label: string;
  selected: boolean;
  /** Autoplay highlight (process-flow); optional. */
  lit?: boolean;
  onSelect: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "min-h-11 min-w-[4.5rem] max-w-[7.5rem] flex-1 rounded-lg border px-2 py-2 text-center text-[11px] font-medium leading-snug transition-colors sm:text-xs",
        selected
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : lit
            ? "border-primary/60 bg-primary/15 text-foreground"
            : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-muted/60",
        className,
      )}
    >
      {label}
    </button>
  );
}

/** Stages + selection + detail node for a catalog payload. */
export function useDiagramStageUi(
  typeId: EduaiDiagramCanonicalId,
  payload: EduaiDiagramPayload,
) {
  const stages = resolveDiagramStages(typeId, payload);
  const resetKey = diagramStageResetKey(payload.title, stages);
  const selection = useDiagramStageSelection(stages, resetKey);
  return {
    stages,
    ...selection,
    detail: <DiagramStageDetail stage={selection.selectedStage} />,
  };
}
