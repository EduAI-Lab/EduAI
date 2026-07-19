/**
 * Parse / build labeled eduai-diagram fence bodies so diagrams carry
 * topic-specific stages (not just a type id).
 */

import {
  matchExplicitDiagramTypeId,
  resolveEduaiDiagramTypeId,
  type EduaiDiagramCanonicalId,
} from "~/lib/ai/eduai-diagram-type";

export type EduaiDiagramStage = {
  label: string;
  detail: string;
};

export type EduaiDiagramPayload = {
  typeId: EduaiDiagramCanonicalId;
  title?: string;
  stages: EduaiDiagramStage[];
};

const DEFAULT_PROCESS_STAGES: EduaiDiagramStage[] = [
  { label: "Start", detail: "Where this process begins." },
  { label: "Step", detail: "An intermediate stage." },
  { label: "Step", detail: "Another intermediate stage." },
  { label: "Result", detail: "Where this process ends." },
];

const DEFAULT_HIERARCHY_STAGES: EduaiDiagramStage[] = [
  { label: "Whole", detail: "The root idea." },
  { label: "Part A", detail: "First branch." },
  { label: "Part B", detail: "Second branch." },
  { label: "Part C", detail: "Third branch." },
];

const DEFAULT_COMPARE_STAGES: EduaiDiagramStage[] = [
  { label: "Option A", detail: "First side of the comparison." },
  { label: "Option B", detail: "Second side of the comparison." },
];

/** Same stage contract as other catalog types — visual can still be specialized. */
const DEFAULT_GRADIENT_STAGES: EduaiDiagramStage[] = [
  { label: "Start point", detail: "Pick initial parameter values on the loss surface." },
  { label: "Compute gradient", detail: "Find the steepest uphill direction at that point." },
  { label: "Step downhill", detail: "Move opposite the gradient by the learning rate." },
  { label: "Near minimum", detail: "Repeat until steps get small near the lowest cost." },
];

function clampLabel(raw: string): string {
  const words = raw.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  return words.slice(0, 4).join(" ").slice(0, 32);
}

function clampDetail(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 160);
}

/**
 * Only treat a line as a type token when it matches a known catalog id/alias
 * (or `type: …`). Bare labels like "Start" stay as stages.
 */
function looksLikeTypeId(line: string): string | null {
  const typePrefixed = /^type\s*:\s*([a-z0-9_-]+)$/i.exec(line);
  if (typePrefixed) {
    const token = typePrefixed[1] ?? "";
    return matchExplicitDiagramTypeId(token) ? token : null;
  }
  if (/^[a-z0-9_-]+$/i.test(line) && matchExplicitDiagramTypeId(line)) {
    return line;
  }
  return null;
}

function splitLabelDetail(line: string): EduaiDiagramStage | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (/^title\s*:/i.test(trimmed)) return null;

  const colon = trimmed.indexOf(":");
  if (colon <= 0) {
    const bare = clampLabel(
      trimmed.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, ""),
    );
    if (!bare) return null;
    return { label: bare, detail: "" };
  }

  const left = trimmed.slice(0, colon).trim();
  const right = trimmed.slice(colon + 1).trim();
  const label = clampLabel(
    left.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, ""),
  );
  if (!label) return null;
  return { label, detail: clampDetail(right) };
}

export function defaultStagesForType(
  typeId: EduaiDiagramCanonicalId,
): EduaiDiagramStage[] {
  if (typeId === "hierarchy") return DEFAULT_HIERARCHY_STAGES.map((s) => ({ ...s }));
  if (typeId === "compare") return DEFAULT_COMPARE_STAGES.map((s) => ({ ...s }));
  if (typeId === "gradient-descent") {
    return DEFAULT_GRADIENT_STAGES.map((s) => ({ ...s }));
  }
  return DEFAULT_PROCESS_STAGES.map((s) => ({ ...s }));
}

export function normalizeStagesForType(
  typeId: EduaiDiagramCanonicalId,
  stages: EduaiDiagramStage[],
): EduaiDiagramStage[] {
  const cleaned = stages
    .map((s) => ({
      label: clampLabel(s.label),
      detail: clampDetail(s.detail ?? ""),
    }))
    .filter((s) => s.label.length > 0);

  if (cleaned.length === 0) return defaultStagesForType(typeId);

  if (typeId === "compare") {
    while (cleaned.length < 2) {
      cleaned.push({ ...DEFAULT_COMPARE_STAGES[cleaned.length]! });
    }
    return cleaned.slice(0, 2);
  }

  if (typeId === "hierarchy") {
    return cleaned.slice(0, 4);
  }

  // process-flow and gradient-descent: 3–5 stages
  if (cleaned.length < 3) {
    const defaults = defaultStagesForType(typeId);
    const used = new Set(cleaned.map((s) => s.label.toLowerCase()));
    for (const d of defaults) {
      if (cleaned.length >= 3) break;
      if (used.has(d.label.toLowerCase())) continue;
      cleaned.push({ ...d });
      used.add(d.label.toLowerCase());
    }
  }
  return cleaned.slice(0, 5);
}

/**
 * Parse the body of an ```eduai-diagram fence (without the fences).
 */
export function parseEduaiDiagramBody(body: string): EduaiDiagramPayload {
  const lines = (body ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  let typeRaw = "";
  let title: string | undefined;
  const stageLines: string[] = [];

  for (const line of lines) {
    const titleMatch = /^title\s*:\s*(.+)$/i.exec(line);
    if (titleMatch) {
      title = (titleMatch[1] ?? "").trim().replace(/\s+/g, " ").slice(0, 64) || undefined;
      continue;
    }

    if (!typeRaw) {
      const asType = looksLikeTypeId(line);
      if (asType) {
        typeRaw = asType;
        continue;
      }
      stageLines.push(line);
      continue;
    }

    stageLines.push(line);
  }

  const typeId = resolveEduaiDiagramTypeId({
    explicitTypeId: typeRaw || "process-flow",
  });
  const stages = normalizeStagesForType(
    typeId,
    stageLines
      .map(splitLabelDetail)
      .filter((s): s is EduaiDiagramStage => s !== null),
  );

  return { typeId, title, stages };
}

/**
 * Pull stages from Step ladder numbered items, else Top summary bullets.
 */
export function extractStagesFromDraft(markdown: string): EduaiDiagramStage[] {
  const text = markdown ?? "";

  const stepLadder =
    /###\s*Step ladder[\s\S]*?(?=\n###|\n\*\*Next\?\*\*|\n```|$)/i.exec(text)?.[0] ??
    "";

  const fromNumbered: EduaiDiagramStage[] = [];
  for (const match of stepLadder.matchAll(/(?:^|\n)\s*(\d+)[.)]\s+(.+)/g)) {
    const item = (match[2] ?? "").trim();
    if (!item) continue;
    const stage = splitLabelDetail(item.includes(":") ? item : `${clampLabel(item.split(/\s+/).slice(0, 3).join(" "))}: ${item}`);
    if (stage) fromNumbered.push(stage);
  }

  // Return raw stages only — callers normalize for the resolved catalog type
  // so gradient-descent / hierarchy are not padded with process-flow defaults.
  if (fromNumbered.length >= 2) {
    return fromNumbered.slice(0, 5);
  }

  const bulletRegion =
    /\*\*Top summary\*\*([\s\S]*?)(?=\n###|\n\*\*Next\?\*\*|\n```|$)/i.exec(text)?.[1] ??
    "";

  const fromBullets: EduaiDiagramStage[] = [];
  for (const match of bulletRegion.matchAll(/(?:^|\n)\s*[-*•]\s+(.+)/g)) {
    const item = (match[1] ?? "").trim();
    if (!item) continue;

    const bold = /^\*\*(.+?)\*\*\s*[-–—:]?\s*(.*)$/.exec(item);
    if (bold) {
      fromBullets.push({
        label: clampLabel(bold[1] ?? ""),
        detail: clampDetail(bold[2] ?? item),
      });
      continue;
    }

    if (item.includes(":")) {
      const stage = splitLabelDetail(item);
      if (stage) fromBullets.push(stage);
      continue;
    }

    const words = item.split(/\s+/);
    fromBullets.push({
      label: clampLabel(words.slice(0, 3).join(" ")),
      detail: clampDetail(item),
    });
  }

  if (fromBullets.length >= 2) {
    return fromBullets.slice(0, 5);
  }

  return [];
}

export function inferDiagramTitle(userText?: string): string | undefined {
  const t = (userText ?? "").trim();
  if (!t) return undefined;
  const cleaned = t
    .replace(
      /\b(draw|sketch|animate|show|diagram|visual(ly)?|of|a|an|the|me|please)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 3) return undefined;
  const capped = cleaned.slice(0, 64);
  return capped.charAt(0).toUpperCase() + capped.slice(1);
}

export function buildEduaiDiagramFence(args: {
  typeId: string;
  title?: string;
  stages?: EduaiDiagramStage[];
  userText?: string;
  draftText?: string;
}): string {
  const typeId = resolveEduaiDiagramTypeId({
    explicitTypeId: args.typeId,
    userText: args.userText,
    draftText: args.draftText,
  });

  let stages = args.stages ?? [];
  if (stages.length === 0 && args.draftText) {
    stages = extractStagesFromDraft(args.draftText);
  }
  stages = normalizeStagesForType(typeId, stages);

  const title =
    args.title?.trim() || inferDiagramTitle(args.userText) || undefined;

  const lines = ["```eduai-diagram", typeId];
  if (title) {
    lines.push(`title: ${title}`);
  }
  for (const stage of stages) {
    lines.push(stage.detail ? `${stage.label}: ${stage.detail}` : stage.label);
  }
  lines.push("```");
  return lines.join("\n");
}
