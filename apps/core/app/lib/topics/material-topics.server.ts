import { Prisma } from "@prisma/client";

import { invalidateCourseTopicNamesCache } from "~/lib/courses/server";
import prisma from "~/lib/prisma.server";
import {
  looseTopicKey,
  MAX_TOPIC_NAME_LENGTH,
  MAX_TOPICS_PER_MATERIAL,
} from "~/lib/topics/candidates";

/**
 * Which topic links count as a material's topics (#1965): live, accepted ones.
 *
 * A link to an unreviewed suggestion only records where the suggestion came
 * from. It becomes one of the material's topics when the suggestion is approved.
 */
export const MATERIAL_TOPIC_WHERE = {
  deletedAt: null,
  reviewStatus: "ACCEPTED",
} satisfies Prisma.CourseTopicWhereInput;

export type MaterialTopic = {
  id: string;
  name: string;
  /** How automatic matching chose this topic (#1998); absent or null when a person did. */
  matchedBy?: "NAME" | "AI" | null;
  /** The model's own 0–100 estimate for an AI match. */
  matchConfidence?: number | null;
};

/** Each material's topics, main topic first. Materials with none are absent from the map. */
export async function topicsForMaterials(
  materialIds: string[],
): Promise<Map<string, MaterialTopic[]>> {
  const byMaterial = new Map<string, MaterialTopic[]>();
  if (materialIds.length === 0) return byMaterial;

  const links = await prisma.courseTopicSource.findMany({
    where: { materialId: { in: materialIds }, topic: MATERIAL_TOPIC_WHERE },
    select: {
      materialId: true,
      matchedBy: true,
      matchConfidence: true,
      topic: { select: { id: true, name: true } },
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  for (const link of links) {
    const topic: MaterialTopic = {
      ...link.topic,
      matchedBy: link.matchedBy,
      matchConfidence: link.matchConfidence,
    };
    byMaterial.set(link.materialId, [...(byMaterial.get(link.materialId) ?? []), topic]);
  }
  return byMaterial;
}

/** One entry of a material's chosen topics: an existing topic, or a name to find or create. */
export type MaterialTopicChoice = { topicId: string } | { name: string };

type SetMaterialTopicsArgs = {
  courseId: string;
  materialId: string;
  topics: MaterialTopicChoice[];
  userId: string;
  /** Whether the caller may create topics; only consulted when a name is new. */
  canCreateTopics: boolean;
};

export type SetMaterialTopicsOutcome =
  | { status: "200"; topics: MaterialTopic[]; createdTopics: MaterialTopic[] }
  | {
      status: "400" | "403" | "404" | "409";
      error:
        | "TOO_MANY_TOPICS"
        | "INVALID_TOPIC_NAME"
        | "MATERIAL_NOT_FOUND"
        | "TOPIC_NOT_FOUND"
        | "TOPIC_CREATE_FORBIDDEN"
        | "TOPIC_NAME_TAKEN";
    };

/** Collapse whitespace; the stored name is what the instructor typed, tidied. */
function tidyName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export type TopicTransaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** A chosen topic was dismissed or deleted after the request read it. */
class TopicGoneError extends Error {}

/**
 * File the materials a suggestion came from under `targetId`, which is the
 * suggestion itself on approval or the merge target (#1966).
 *
 * A material already at `MAX_TOPICS_PER_MATERIAL` accepted topics is skipped:
 * nothing it has is removed to make room. On approval the suggestion's link to
 * such a material is deleted, since it would otherwise count as a fourth topic.
 * Every material is eligible otherwise, including one whose topics an
 * instructor set — approving a card that names the file is their choice too —
 * and a deleted one, so restoring it cannot bring back a fourth topic.
 *
 * `exceptMaterialId` is the file whose topics the caller is writing itself:
 * naming a suggestion in a file's picker approves it (#1988 review), and the
 * other files it was suggested for get it here, within their cap.
 */
export async function fileSourcesUnder(
  tx: TopicTransaction,
  suggestionId: string,
  targetId: string,
  exceptMaterialId?: string,
): Promise<void> {
  const sources = await tx.courseTopicSource.findMany({
    where: {
      topicId: suggestionId,
      // Prisma ignores an undefined `not`, so with no exception every file is read.
      materialId: { not: exceptMaterialId },
    },
    select: { materialId: true },
  });

  for (const { materialId } of sources) {
    const filed = await tx.courseTopicSource.findMany({
      where: { materialId, topicId: { not: suggestionId }, topic: MATERIAL_TOPIC_WHERE },
      select: { topicId: true, position: true },
    });
    const alreadyFiled = filed.some((link) => link.topicId === targetId);
    const full = filed.length >= MAX_TOPICS_PER_MATERIAL;

    if (targetId === suggestionId) {
      if (full) {
        await tx.courseTopicSource.deleteMany({ where: { topicId: suggestionId, materialId } });
      } else {
        const position = filed.reduce((max, link) => Math.max(max, link.position + 1), 0);
        await tx.courseTopicSource.updateMany({
          where: { topicId: suggestionId, materialId },
          data: { position },
        });
      }
      continue;
    }

    if (alreadyFiled || full) continue;
    const position = filed.reduce((max, link) => Math.max(max, link.position + 1), 0);
    await tx.courseTopicSource.upsert({
      where: { topicId_materialId: { topicId: targetId, materialId } },
      create: { topicId: targetId, materialId, position },
      update: { position },
    });
  }
}

/**
 * Replace a material's topics with the given ordered list, as a person's choice
 * (#1965). The first entry becomes the main topic.
 *
 * A name is resolved against the course's live topics first, ignoring case,
 * punctuation, and simple plurals, so typing "Loop" files the material under an
 * existing "Loops" instead of creating a near-duplicate. A pending suggestion
 * with that name is approved, since naming it is the instructor accepting it.
 * Only a genuinely new name creates a topic, and only for a caller who may
 * create topics.
 *
 * Marks the material as set by hand, so auto-matching never changes it again.
 * Links to unreviewed suggestions are left in place: they are provenance, not
 * the material's topics.
 */
export async function setMaterialTopics(
  args: SetMaterialTopicsArgs,
): Promise<SetMaterialTopicsOutcome> {
  const material = await prisma.courseMaterial.findFirst({
    where: { id: args.materialId, courseId: args.courseId, deletedAt: null },
    select: { id: true },
  });
  if (!material) return { status: "404", error: "MATERIAL_NOT_FOUND" };

  const names = args.topics.flatMap((choice) => ("name" in choice ? [tidyName(choice.name)] : []));
  if (names.some((name) => name.length === 0 || name.length > MAX_TOPIC_NAME_LENGTH)) {
    return { status: "400", error: "INVALID_TOPIC_NAME" };
  }

  const liveTopics = await prisma.courseTopic.findMany({
    where: { courseId: args.courseId, deletedAt: null },
    select: { id: true, name: true, reviewStatus: true },
    orderBy: { createdAt: "asc" },
  });
  const byId = new Map(liveTopics.map((topic) => [topic.id, topic]));
  const byKey = new Map<string, (typeof liveTopics)[number]>();
  for (const topic of liveTopics) {
    const key = looseTopicKey(topic.name);
    // Prefer an accepted topic over a suggestion that shares its key.
    const held = byKey.get(key);
    if (!held || (held.reviewStatus !== "ACCEPTED" && topic.reviewStatus === "ACCEPTED")) {
      byKey.set(key, topic);
    }
  }

  // Resolve every choice before writing anything, so a bad entry changes nothing.
  type Resolved =
    | { kind: "existing"; topic: (typeof liveTopics)[number] }
    | { kind: "new"; name: string };
  const resolved: Resolved[] = [];
  const seen = new Set<string>();
  for (const choice of args.topics) {
    let entry: Resolved;
    if ("topicId" in choice) {
      const topic = byId.get(choice.topicId);
      // Only accepted topics can be chosen by id; a suggestion is approved by name.
      if (!topic || topic.reviewStatus !== "ACCEPTED") {
        return { status: "404", error: "TOPIC_NOT_FOUND" };
      }
      entry = { kind: "existing", topic };
    } else {
      const name = tidyName(choice.name);
      const topic = byKey.get(looseTopicKey(name));
      entry = topic ? { kind: "existing", topic } : { kind: "new", name };
    }
    const key = entry.kind === "existing" ? entry.topic.id : `new:${looseTopicKey(entry.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push(entry);
  }

  if (resolved.length > MAX_TOPICS_PER_MATERIAL) {
    return { status: "400", error: "TOO_MANY_TOPICS" };
  }
  const needsCreate = resolved.some(
    (entry) =>
      entry.kind === "new" ||
      (entry.kind === "existing" && entry.topic.reviewStatus !== "ACCEPTED"),
  );
  if (needsCreate && !args.canCreateTopics) {
    return { status: "403", error: "TOPIC_CREATE_FORBIDDEN" };
  }

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const topics: MaterialTopic[] = [];
      const createdTopics: MaterialTopic[] = [];
      const approved: string[] = [];

      for (const entry of resolved) {
        if (entry.kind === "new") {
          const topic = await tx.courseTopic.create({
            data: {
              courseId: args.courseId,
              name: entry.name,
              origin: "HUMAN",
              reviewStatus: "ACCEPTED",
              createdBy: args.userId,
            },
            select: { id: true, name: true },
          });
          topics.push(topic);
          createdTopics.push(topic);
        } else {
          // The topics were read before this transaction, so check again here:
          // another instructor may have dismissed or approved it meanwhile.
          if (entry.topic.reviewStatus !== "ACCEPTED") {
            const { count } = await tx.courseTopic.updateMany({
              where: { id: entry.topic.id, deletedAt: null, reviewStatus: { not: "ACCEPTED" } },
              data: { reviewStatus: "ACCEPTED" },
            });
            if (count === 1) approved.push(entry.topic.id);
          }
          const live = await tx.courseTopic.findFirst({
            where: { id: entry.topic.id, deletedAt: null, reviewStatus: "ACCEPTED" },
            select: { id: true },
          });
          if (!live) throw new TopicGoneError();
          topics.push({ id: entry.topic.id, name: entry.topic.name });
        }
      }

      // Naming a pending suggestion approves it for the whole course, which turns
      // its links to other files into their topics too (#1988 review); file
      // those within each file's cap, as the review card's Approve does. Only the
      // request that approved it does this, so a concurrent approval runs it once.
      for (const topicId of approved) {
        await fileSourcesUnder(tx, topicId, topicId, args.materialId);
      }

      const keepIds = topics.map((topic) => topic.id);
      await tx.courseTopicSource.deleteMany({
        where: {
          materialId: args.materialId,
          topicId: { notIn: keepIds },
          topic: MATERIAL_TOPIC_WHERE,
        },
      });
      for (const [position, topic] of topics.entries()) {
        await tx.courseTopicSource.upsert({
          where: { topicId_materialId: { topicId: topic.id, materialId: args.materialId } },
          // A person chose these topics, so none is automatic any more (#1998).
          create: { topicId: topic.id, materialId: args.materialId, position },
          update: { position, matchedBy: null, matchConfidence: null },
        });
      }
      await tx.courseMaterial.update({
        where: { id: args.materialId },
        data: { topicsSetManuallyAt: new Date() },
      });

      return { topics, createdTopics };
    });

    // A created topic or an approved suggestion changes the course's topic names.
    if (needsCreate) invalidateCourseTopicNamesCache(args.courseId);
    return { status: "200", ...outcome };
  } catch (error) {
    if (error instanceof TopicGoneError) return { status: "404", error: "TOPIC_NOT_FOUND" };
    // A new name that exactly matches a deleted topic (a dismissed suggestion or
    // a removed topic), or one a concurrent request just created.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "409", error: "TOPIC_NAME_TAKEN" };
    }
    throw error;
  }
}
