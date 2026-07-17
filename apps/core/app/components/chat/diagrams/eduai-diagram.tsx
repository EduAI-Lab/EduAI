import type { ComponentType } from "react";
import { AnimatedCompare } from "~/components/chat/diagrams/animated-compare";
import { AnimatedGradientDescent } from "~/components/chat/diagrams/animated-gradient-descent";
import { AnimatedHierarchy } from "~/components/chat/diagrams/animated-hierarchy";
import { AnimatedProcessFlow } from "~/components/chat/diagrams/animated-process-flow";
import {
  EDUAI_DIAGRAM_CANONICAL_IDS,
  resolveEduaiDiagramTypeId,
} from "~/lib/ai/eduai-diagram-type";
import type { EduaiDiagramPayload } from "~/lib/ai/eduai-diagram-payload";

type DiagramComponent = ComponentType<{
  className?: string;
  payload: EduaiDiagramPayload;
}>;

const REGISTRY: Record<string, DiagramComponent> = {
  "process-flow": AnimatedProcessFlow,
  process: AnimatedProcessFlow,
  flow: AnimatedProcessFlow,
  steps: AnimatedProcessFlow,
  "gradient-descent": AnimatedGradientDescent as DiagramComponent,
  gradient_descent: AnimatedGradientDescent as DiagramComponent,
  gd: AnimatedGradientDescent as DiagramComponent,
  hierarchy: AnimatedHierarchy,
  tree: AnimatedHierarchy,
  structure: AnimatedHierarchy,
  compare: AnimatedCompare,
  vs: AnimatedCompare,
  contrast: AnimatedCompare,
};

export const EDUAI_DIAGRAM_TYPE_IDS = [...EDUAI_DIAGRAM_CANONICAL_IDS];

export function normalizeEduaiDiagramTypeId(raw: string): string {
  return resolveEduaiDiagramTypeId({ explicitTypeId: raw });
}

export function resolveEduaiDiagramComponent(typeId: string): DiagramComponent {
  const id = normalizeEduaiDiagramTypeId(typeId);
  return REGISTRY[id] ?? AnimatedProcessFlow;
}

export function EduaiDiagram({
  payload,
  typeId,
  className,
}: {
  payload?: EduaiDiagramPayload;
  /** @deprecated Prefer passing full payload */
  typeId?: string;
  className?: string;
}) {
  const resolved: EduaiDiagramPayload = payload ?? {
    typeId: resolveEduaiDiagramTypeId({
      explicitTypeId: typeId ?? "process-flow",
    }),
    stages: [],
  };
  const Component = resolveEduaiDiagramComponent(resolved.typeId);
  return <Component className={className} payload={resolved} />;
}
