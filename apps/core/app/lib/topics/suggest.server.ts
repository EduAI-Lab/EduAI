import { Prisma } from "@prisma/client";

import prisma from "~/lib/prisma.server";
import { looseTopicKey, ORIGIN_CONFIDENCE } from "~/lib/topics/candidates";
import { canvasModuleNamesByMaterial } from "~/lib/topics/canvas-module-names.server";
import { FALLBACK_TOPIC_NAME } from "~/lib/topics/fallback.server";
import { extractHeadingCandidates } from "~/lib/topics/headings";
import { topicsForMaterials } from "~/lib/topics/material-topics.server";
import type { RunTopicCompletion } from "~/lib/topics/provision.server";
import {
  buildTopicSuggestPrompt,
  MAX_SUGGEST_MATERIALS,
  parseTopicSuggestResponse,
  summarizeMaterial,
  TOPIC_SUGGEST_SYSTEM_PROMPT,
} from "~/lib/topics/suggest-prompt";

export type TopicSuggestResult = {
  created: number;
  createdNames: string[];
  /** Proposals dropped because the course already had, or had dismissed, that topic. */
  duplicatesSkipped: number;
};

type SuggestArgs = {
  courseId: string;
  canvasCourseId?: string | null;
  /** Owner of the Canvas credentials used to read modules. */
  userId: string;
  jobId: string;
  runCompletion: RunTopicCompletion;
  fetchImpl?: typeof fetch;
};

/**
 * Propose the topics a course is missing, from all of its materials (#1966).
 *
 * One model call sees every topic the course has — accepted, awaiting review,
 * and dismissed — plus a short summary of each material, and may only propose
 * what none of those cover. Its answer is checked again here: a name that
 * matches any of them (ignoring case, punctuation, and simple plurals) is
 * dropped, as is one that cites no real file. Each survivor is created as a
 * suggestion linked to the files it covers, so the review card can show them
 * and approving it can file them (see `approveGeneratedTopic`).
 *
 * Existing topics are never renamed, merged, or deleted. A provider failure
 * propagates so the job is recorded as failed and the instructor can retry.
 */
export async function suggestCourseTopics(args: SuggestArgs): Promise<TopicSuggestResult> {
  const result: TopicSuggestResult = { created: 0, createdNames: [], duplicatesSkipped: 0 };

  const materials = await prisma.courseMaterial.findMany({
    where: { courseId: args.courseId, status: "READY", deletedAt: null },
    select: { id: true, title: true, rawText: true, externalId: true, externalSource: true },
    // Newest first: past the cap, recent uploads are the likeliest to need a
    // topic the course doesn't have yet.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_SUGGEST_MATERIALS,
  });
  if (materials.length === 0) return result;

  const topics = await prisma.courseTopic.findMany({
    where: { courseId: args.courseId },
    select: { name: true, origin: true, reviewStatus: true, deletedAt: true },
    orderBy: { createdAt: "asc" },
  });
  const accepted: string[] = [];
  const pending: string[] = [];
  const dismissed: string[] = [];
  for (const topic of topics) {
    if (topic.origin === "SYSTEM") continue;
    if (topic.deletedAt) dismissed.push(topic.name);
    else if (topic.reviewStatus === "ACCEPTED") accepted.push(topic.name);
    else pending.push(topic.name);
  }
  // Every name the course holds or has held, plus the reserved fallback.
  const taken = new Set([...topics.map((t) => t.name), FALLBACK_TOPIC_NAME].map(looseTopicKey));

  const [canvasNames, materialTopics] = await Promise.all([
    canvasModuleNamesByMaterial(args, materials),
    topicsForMaterials(materials.map((material) => material.id)),
  ]);
  const summaries = materials.map((material) => {
    const headings = extractHeadingCandidates(material.id, material.rawText).map((h) => h.name);
    return summarizeMaterial({
      title: material.title,
      canvasModules: canvasNames.get(material.id) ?? [],
      headings,
      excerpt: headings.length === 0 ? material.rawText : null,
      topics: (materialTopics.get(material.id) ?? []).map((topic) => topic.name),
    });
  });

  const content = await args.runCompletion({
    systemPrompt: TOPIC_SUGGEST_SYSTEM_PROMPT,
    prompt: buildTopicSuggestPrompt({ accepted, pending, dismissed, materials: summaries }),
  });
  if (!content) return result;

  for (const suggestion of parseTopicSuggestResponse(content, materials.length)) {
    const key = looseTopicKey(suggestion.name);
    if (taken.has(key)) {
      result.duplicatesSkipped += 1;
      continue;
    }
    taken.add(key);

    const created = await createSuggestion(
      args,
      suggestion.name,
      suggestion.files.map((index) => materials[index].id),
    );
    if (created) {
      result.created += 1;
      result.createdNames.push(suggestion.name);
    } else {
      result.duplicatesSkipped += 1;
    }
  }
  return result;
}

/**
 * Create one suggestion linked to its files. Returns false when the name lost a
 * race with an instructor or another job for `@@unique([courseId, name])`.
 */
async function createSuggestion(
  args: SuggestArgs,
  name: string,
  materialIds: string[],
): Promise<boolean> {
  try {
    await prisma.courseTopic.create({
      data: {
        courseId: args.courseId,
        name,
        origin: "AI",
        reviewStatus: "SUGGESTED",
        confidence: ORIGIN_CONFIDENCE.AI,
        generatedByJobId: args.jobId,
        // Left null on purpose: an unreviewed generated topic has no human
        // owner, and `createdBy` is what the TA own-only carve-out keys on.
        createdBy: null,
        sources: { create: materialIds.map((materialId) => ({ materialId })) },
      },
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return false;
    }
    throw error;
  }
}
