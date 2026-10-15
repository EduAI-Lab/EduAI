import { listCanvasCourseModules } from "~/lib/canvas/client.server";
import { requireCanvasCredentials } from "~/lib/canvas/courses.server";
import prisma from "~/lib/prisma.server";
import { looseTopicKey, MAX_TOPICS_PER_MATERIAL } from "~/lib/topics/candidates";
import { MATERIAL_TOPIC_WHERE } from "~/lib/topics/material-topics.server";
import { extractCanvasModuleCandidates } from "~/lib/topics/canvas-modules";
import { extractHeadingCandidates } from "~/lib/topics/headings";
import {
  buildTopicMatchPrompt,
  parseTopicMatchResponse,
  TOPIC_MATCH_SYSTEM_PROMPT,
} from "~/lib/topics/match-prompt";
import type { RunTopicCompletion } from "~/lib/topics/provision.server";

export type TopicMatchResult = {
  /** Materials filed under an existing topic by this run. */
  matched: number;
  /** Materials compared against the course's topics that fit none of them. */
  unmatched: number;
};

type MatchArgs = {
  courseId: string;
  materialIds: string[];
  canvasCourseId?: string | null;
  /** Owner of the Canvas credentials used to read modules. */
  userId: string;
  runCompletion: RunTopicCompletion;
  /**
   * Called after each material, so a long batch (up to one model call per file)
   * keeps renewing its job lease instead of being reclaimed mid-run as abandoned.
   */
  heartbeat?: () => Promise<void>;
  fetchImpl?: typeof fetch;
};

type MatchMaterial = {
  id: string;
  title: string;
  rawText: string | null;
  externalId: string | null;
  externalSource: string | null;
  processedAt: Date | null;
};

type MatchTopic = { id: string; name: string };

/**
 * File each processed material under the course's existing topics (#1965).
 *
 * Only accepted topics are candidates: an unreviewed suggestion is not yet a
 * topic the instructor has agreed the course has, and the SYSTEM fallback is not
 * a subject at all. Matching never creates, renames, or removes a topic, and
 * leaves alone any material whose topics a person has set.
 *
 * Per material, the cheapest test first:
 * 1. Its Canvas module name or first heading names a topic (ignoring case,
 *    punctuation, and simple plurals): linked with no model call.
 * 2. Otherwise the model sees the topic list and an excerpt and must choose a
 *    listed topic or answer none. A choice that is not a real topic is ignored.
 *
 * A course with no accepted topics has nothing to match against, so no model is
 * called at all. A provider failure propagates so the job is recorded as failed
 * and the instructor gets a retry.
 */
export async function matchMaterialsToTopics(args: MatchArgs): Promise<TopicMatchResult> {
  const result: TopicMatchResult = { matched: 0, unmatched: 0 };

  const topics = await prisma.courseTopic.findMany({
    where: {
      courseId: args.courseId,
      deletedAt: null,
      reviewStatus: "ACCEPTED",
      origin: { not: "SYSTEM" },
    },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  if (topics.length === 0) return result;

  const materials = await prisma.courseMaterial.findMany({
    where: {
      id: { in: args.materialIds },
      courseId: args.courseId,
      status: "READY",
      deletedAt: null,
      topicsSetManuallyAt: null,
    },
    select: {
      id: true,
      title: true,
      rawText: true,
      externalId: true,
      externalSource: true,
      processedAt: true,
    },
    orderBy: { id: "asc" },
  });
  if (materials.length === 0) return result;

  const filed = await alreadyFiledMaterialIds(materials);
  const pending = materials.filter((material) => !filed.has(material.id));
  if (pending.length === 0) return result;

  const byKey = new Map<string, MatchTopic>();
  for (const topic of topics) {
    const key = looseTopicKey(topic.name);
    if (!byKey.has(key)) byKey.set(key, topic);
  }
  const canvasNames = await canvasModuleNamesByMaterial(args, pending);

  for (const material of pending) {
    const topic = await chooseTopic(args, material, canvasNames, byKey, topics);
    if (topic && (await linkAutomatically(material.id, topic.id))) {
      result.matched += 1;
    } else if (!topic) {
      result.unmatched += 1;
    }
    await args.heartbeat?.();
  }

  return result;
}

async function chooseTopic(
  args: MatchArgs,
  material: MatchMaterial,
  canvasNames: Map<string, string[]>,
  byKey: Map<string, MatchTopic>,
  topics: MatchTopic[],
): Promise<MatchTopic | null> {
  // 1. The course's own structure already names a topic: no model needed.
  for (const name of structureNames(material, canvasNames)) {
    const topic = byKey.get(looseTopicKey(name));
    if (topic) return topic;
  }

  // 2. Ask the model to choose from the list.
  const content = await args.runCompletion({
    systemPrompt: TOPIC_MATCH_SYSTEM_PROMPT,
    prompt: buildTopicMatchPrompt({
      topics: topics.map((topic) => topic.name),
      material,
    }),
  });
  const decision = content ? parseTopicMatchResponse(content) : null;
  if (decision?.kind !== "match") return null;
  // A name that is not a real topic is not trusted.
  return byKey.get(looseTopicKey(decision.name)) ?? null;
}

/** The structure names for one material, most trusted first: its Canvas module, then its first heading. */
function structureNames(material: MatchMaterial, canvasNames: Map<string, string[]>): string[] {
  const names = [...(canvasNames.get(material.id) ?? [])];
  const [heading] = extractHeadingCandidates(material.id, material.rawText);
  if (heading) names.push(heading.name);
  return names;
}

/**
 * Canvas module names per material, or an empty map when the course is not
 * Canvas linked, the user has no stored credentials, or Canvas is unreachable.
 *
 * A Canvas failure must not fail the job: the heading and model paths still work.
 */
async function canvasModuleNamesByMaterial(
  args: MatchArgs,
  materials: MatchMaterial[],
): Promise<Map<string, string[]>> {
  const byMaterial = new Map<string, string[]>();
  if (!args.canvasCourseId) return byMaterial;

  const materialIdByCanvasFileId = new Map<string, string>();
  for (const material of materials) {
    if (material.externalSource === "canvas" && material.externalId) {
      materialIdByCanvasFileId.set(material.externalId, material.id);
    }
  }
  if (materialIdByCanvasFileId.size === 0) return byMaterial;

  try {
    const credentials = await requireCanvasCredentials(args.userId);
    const modules = await listCanvasCourseModules(
      credentials,
      args.canvasCourseId,
      args.fetchImpl ?? fetch,
    );
    for (const candidate of extractCanvasModuleCandidates(modules, materialIdByCanvasFileId)) {
      for (const materialId of candidate.materialIds) {
        byMaterial.set(materialId, [...(byMaterial.get(materialId) ?? []), candidate.name]);
      }
    }
  } catch (error) {
    console.error("[topic-match] Canvas module read failed; continuing without it", error);
  }
  return byMaterial;
}

/**
 * Materials already filed under an accepted topic since they were last processed.
 *
 * A retry or restore of an unchanged file finds it filed and leaves it alone. A
 * file whose content changed in place (a Canvas resync keeps the row) was
 * reprocessed after its link was made, so it is matched again. Its old link
 * stays: matching never removes a topic from a material.
 *
 * Links to unreviewed suggestions don't count — they record where a suggestion
 * came from, not a topic the material has been filed under.
 */
async function alreadyFiledMaterialIds(materials: MatchMaterial[]): Promise<Set<string>> {
  const rows = await prisma.courseTopicSource.findMany({
    where: {
      materialId: { in: materials.map((material) => material.id) },
      topic: MATERIAL_TOPIC_WHERE,
    },
    select: { materialId: true, createdAt: true },
  });
  const processedAt = new Map(materials.map((material) => [material.id, material.processedAt]));
  const filed = new Set<string>();
  for (const row of rows) {
    const processed = processedAt.get(row.materialId);
    if (!processed || row.createdAt >= processed) filed.add(row.materialId);
  }
  return filed;
}

/**
 * Add one topic to a material, unless a person has taken over its topics in the
 * meantime, it already has the topic, or it is at the cap. Returns whether a
 * link was written.
 *
 * Re-checked inside a transaction because an instructor can set the material's
 * topics while a long batch is still running, and their choice must win.
 */
async function linkAutomatically(materialId: string, topicId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const material = await tx.courseMaterial.findUnique({
      where: { id: materialId },
      select: { topicsSetManuallyAt: true },
    });
    if (!material || material.topicsSetManuallyAt) return false;

    const live = await tx.courseTopicSource.findMany({
      where: { materialId, topic: MATERIAL_TOPIC_WHERE },
      select: { topicId: true, position: true },
    });
    if (live.some((link) => link.topicId === topicId)) return false;
    if (live.length >= MAX_TOPICS_PER_MATERIAL) return false;

    const position = live.length === 0 ? 0 : Math.max(...live.map((link) => link.position)) + 1;
    // Upsert, not create: a link to this topic can survive from before the
    // topic was soft-deleted and restored.
    await tx.courseTopicSource.upsert({
      where: { topicId_materialId: { topicId, materialId } },
      create: { topicId, materialId, position },
      update: { position, createdAt: new Date() },
    });
    return true;
  });
}
