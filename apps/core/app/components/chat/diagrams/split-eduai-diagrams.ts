/**
 * Split assistant markdown into prose vs `eduai-diagram` fenced widgets.
 */

import {
  parseEduaiDiagramBody,
  type EduaiDiagramPayload,
} from "~/lib/ai/eduai-diagram-payload";
import {
  EDUAI_DIAGRAM_FENCE_GLOBAL,
  hasEduaiDiagramFence,
} from "~/lib/ai/eduai-diagram-type";

export type EduaiDiagramSegment =
  | { kind: "markdown"; text: string }
  | { kind: "diagram"; payload: EduaiDiagramPayload };

export function splitEduaiDiagrams(content: string): EduaiDiagramSegment[] {
  const text = content ?? "";
  if (!text) return [];

  const segments: EduaiDiagramSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  EDUAI_DIAGRAM_FENCE_GLOBAL.lastIndex = 0;
  while ((match = EDUAI_DIAGRAM_FENCE_GLOBAL.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before.length > 0) {
      segments.push({ kind: "markdown", text: before });
    }

    const payload = parseEduaiDiagramBody(match[1] ?? "");
    segments.push({ kind: "diagram", payload });

    lastIndex = match.index + match[0].length;
  }

  const rest = text.slice(lastIndex);
  if (rest.length > 0) {
    segments.push({ kind: "markdown", text: rest });
  }

  if (segments.length === 0) {
    return [{ kind: "markdown", text }];
  }

  return segments;
}

/** @deprecated Prefer hasEduaiDiagramFence from eduai-diagram-type */
export function hasEduaiDiagramBlock(text: string): boolean {
  return hasEduaiDiagramFence(text);
}
