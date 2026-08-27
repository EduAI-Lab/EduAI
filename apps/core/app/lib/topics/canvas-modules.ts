import type { CanvasModuleApi } from "~/lib/canvas/client.server";
import {
  ORIGIN_CONFIDENCE,
  cleanTopicName,
  isUsableTopicName,
  type TopicCandidate,
} from "~/lib/topics/candidates";

/**
 * Module names Canvas courses carry by default, which say nothing about the
 * subject matter. Matched on the normalized-ish lowercase name.
 */
const GENERIC_MODULE_NAMES = new Set([
  "course content",
  "course materials",
  "general",
  "home",
  "introduction",
  "misc",
  "miscellaneous",
  "modules",
  "resources",
  "syllabus",
  "uncategorized",
  "welcome",
]);

/** Cap on module-derived topics, mirroring the per-material heading cap. */
export const MAX_MODULE_TOPICS = 60;

/**
 * Canvas module titles as topic candidates (#1624) — the most trustworthy
 * source there is, because an instructor typed them to organise this exact
 * course.
 *
 * `materialIdByCanvasFileId` maps Canvas file ids to the CourseMaterial rows
 * already imported for them, so a module's topic can point at the materials
 * that sit inside it. A module whose files were never imported still yields a
 * topic; it simply carries no sources.
 */
export function extractCanvasModuleCandidates(
  modules: CanvasModuleApi[],
  materialIdByCanvasFileId: ReadonlyMap<string, string>,
): TopicCandidate[] {
  const seen = new Set<string>();
  const candidates: TopicCandidate[] = [];

  for (const module of modules) {
    const name = cleanTopicName(module.name ?? "");
    if (!isUsableTopicName(name)) continue;
    if (GENERIC_MODULE_NAMES.has(name.toLowerCase())) continue;
    if (seen.has(name)) continue;
    seen.add(name);

    const materialIds: string[] = [];
    for (const item of module.items ?? []) {
      if (item.type !== "File" || item.content_id == null) continue;
      const materialId = materialIdByCanvasFileId.get(String(item.content_id));
      if (materialId) materialIds.push(materialId);
    }

    candidates.push({
      name,
      origin: "CANVAS_MODULE",
      confidence: ORIGIN_CONFIDENCE.CANVAS_MODULE,
      materialIds: [...new Set(materialIds)],
    });

    if (candidates.length >= MAX_MODULE_TOPICS) break;
  }

  return candidates;
}
