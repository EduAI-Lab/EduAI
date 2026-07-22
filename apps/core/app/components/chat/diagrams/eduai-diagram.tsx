import type { ComponentType } from "react";
import { AnimatedCompare } from "~/components/chat/diagrams/animated-compare";
import { AnimatedGradientDescent } from "~/components/chat/diagrams/animated-gradient-descent";
import { AnimatedHierarchy } from "~/components/chat/diagrams/animated-hierarchy";
import { AnimatedProcessFlow } from "~/components/chat/diagrams/animated-process-flow";
import {
  EDUAI_DIAGRAM_CANONICAL_IDS,
  resolveEduaiDiagramTypeId,
  type EduaiDiagramCanonicalId,
} from "~/lib/ai/eduai-diagram-type";
import type { EduaiDiagramPayload } from "~/lib/ai/eduai-diagram-payload";

type DiagramComponent = ComponentType<{
  className?: string;
  payload: EduaiDiagramPayload;
}>;

/** Registry keyed only by canonical ids — aliases resolve before lookup. */
const REGISTRY: Record<EduaiDiagramCanonicalId, DiagramComponent> = {
  "process-flow": AnimatedProcessFlow,
  "gradient-descent": AnimatedGradientDescent,
  hierarchy: AnimatedHierarchy,
  compare: AnimatedCompare,
};

export const EDUAI_DIAGRAM_TYPE_IDS = [...EDUAI_DIAGRAM_CANONICAL_IDS];

export function normalizeEduaiDiagramTypeId(raw: string): EduaiDiagramCanonicalId {
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
