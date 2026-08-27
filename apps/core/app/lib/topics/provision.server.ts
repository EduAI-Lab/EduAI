import { listCanvasCourseModules } from "~/lib/canvas/client.server";
import { requireCanvasCredentials } from "~/lib/canvas/courses.server";
import prisma from "~/lib/prisma.server";
import {
  dedupeCandidates,
  rejectExistingCandidates,
  type TopicCandidate,
} from "~/lib/topics/candidates";
import { extractCanvasModuleCandidates } from "~/lib/topics/canvas-modules";
import { extractHeadingCandidates } from "~/lib/topics/headings";
import {
  buildTopicAnalysisPrompt,
  parseTopicAnalysisResponse,
  TOPIC_ANALYSIS_SYSTEM_PROMPT,
  type SampledMaterial,
} from "~/lib/topics/ai";
import { FALLBACK_TOPIC_NAME } from "~/lib/topics/fallback.server";

/** Hard ceiling on topics created by a single job, across all sources. */
export const MAX_TOPICS_PER_JOB = 60;

export type TopicProvisionResult = {
  created: number;
  createdNames: string[];
  /** Which extractor supplied the topics that were actually created. */
  usedSource: "canvas-modules" | "material-headings" | "ai" | "none";
  /** Candidates dropped because the course already had that topic. */
  duplicatesSkipped: number;
};

/** The completion seam, injected so tests never reach a model. */
export type RunTopicCompletion = (args: {
  systemPrompt: string;
  prompt: string;
}) => Promise<string | null>;

type ProvisionArgs = {
  courseId: string;
  materialIds: string[];
  canvasCourseId?: string | null;
  /** Owner of the Canvas credentials used to read modules. */
  userId: string;
  jobId: string;
  runCompletion: RunTopicCompletion;
  fetchImpl?: typeof fetch;
};

/**
 * Canvas module titles for the course, or `[]` when the course is not Canvas
 * linked, the user has no stored credentials, or Canvas is unreachable.
 *
 * A Canvas failure must not fail the job: the heading and AI paths are still
 * perfectly good sources, and the alternative is that one flaky Canvas call
 * leaves a course with no topics at all.
 */
async function canvasModuleCandidates(
  args: ProvisionArgs,
  materialIdByCanvasFileId: ReadonlyMap<string, string>,
): Promise<TopicCandidate[]> {
  if (!args.canvasCourseId) return [];

  try {
    const credentials = await requireCanvasCredentials(args.userId);

    const modules = await listCanvasCourseModules(
      credentials,
      args.canvasCourseId,
      args.fetchImpl ?? fetch,
    );
    return extractCanvasModuleCandidates(modules, materialIdByCanvasFileId);
  } catch (error) {
    console.error("[topic-analysis] Canvas module read failed; falling back", error);
    return [];
  }
}

/**
 * Provision topics for one course from a batch of just-processed materials (#1624).
 *
 * Source precedence is deterministic-first and deliberate: Canvas modules, then
 * chapter/unit headings in the material itself, and only if both come up empty
 * does a model get asked. That ordering is what keeps a hallucinated topic name
 * from ever displacing structure the instructor actually authored.
 *
 * The function only ever creates topics. Existing rows — including soft-deleted
 * ones, which is how a dismissal sticks — are read to exclude duplicates and are
 * never renamed, merged, or deleted.
 */
export async function provisionCourseTopics(args: ProvisionArgs): Promise<TopicProvisionResult> {
  const materials = await prisma.courseMaterial.findMany({
    where: {
      id: { in: args.materialIds },
      courseId: args.courseId,
      status: "READY",
      deletedAt: null,
    },
    select: { id: true, title: true, rawText: true, externalId: true, externalSource: true },
  });

  const materialIdByCanvasFileId = new Map<string, string>();
  for (const material of materials) {
    if (material.externalSource === "canvas" && material.externalId) {
      materialIdByCanvasFileId.set(material.externalId, material.id);
    }
  }

  // Deterministic sources first, in trust order.
  let usedSource: TopicProvisionResult["usedSource"] = "canvas-modules";
  let candidates = await canvasModuleCandidates(args, materialIdByCanvasFileId);

  if (candidates.length === 0) {
    usedSource = "material-headings";
    candidates = materials.flatMap((material) =>
      extractHeadingCandidates(material.id, material.rawText),
    );
  }

  if (candidates.length === 0) {
    usedSource = "ai";
    candidates = await aiCandidates(args, materials);
  }

  if (candidates.length === 0) {
    return { created: 0, createdNames: [], usedSource: "none", duplicatesSkipped: 0 };
  }

  const deduped = dedupeCandidates(candidates);

  // Soft-deleted topics are included on purpose — see rejectExistingCandidates.
  // The SYSTEM fallback topic is excluded from the comparison set so it never
  // blocks a real topic, but it is a reserved name no generator may reuse.
  const existing = await prisma.courseTopic.findMany({
    where: { courseId: args.courseId },
    select: { name: true },
  });
  const fresh = rejectExistingCandidates(deduped, [
    ...existing.map((topic) => topic.name),
    FALLBACK_TOPIC_NAME,
  ]).slice(0, MAX_TOPICS_PER_JOB);

  if (fresh.length === 0) {
    return {
      created: 0,
      createdNames: [],
      usedSource,
      duplicatesSkipped: deduped.length,
    };
  }

  const createdNames = await persistCandidates(args, fresh);

  return {
    created: createdNames.length,
    createdNames,
    usedSource,
    duplicatesSkipped: deduped.length - fresh.length,
  };
}

async function aiCandidates(
  args: ProvisionArgs,
  materials: SampledMaterial[],
): Promise<TopicCandidate[]> {
  const withText = materials.filter((material) => (material.rawText ?? "").trim().length > 0);
  if (withText.length === 0) return [];

  const content = await args.runCompletion({
    systemPrompt: TOPIC_ANALYSIS_SYSTEM_PROMPT,
    prompt: buildTopicAnalysisPrompt(withText),
  });
  if (!content) return [];

  return parseTopicAnalysisResponse(
    content,
    withText.map((material) => material.id),
  );
}

/**
 * Write the candidates, tolerating the unique-constraint race.
 *
 * Each topic is created in its own statement rather than one `createMany`: a
 * concurrent job (or an instructor typing the same name by hand) losing one
 * candidate to `@@unique([courseId, name])` must not roll back the other
 * fifty-nine. Returns the names that were actually created.
 */
async function persistCandidates(
  args: ProvisionArgs,
  candidates: TopicCandidate[],
): Promise<string[]> {
  const created: string[] = [];

  for (const candidate of candidates) {
    try {
      const topic = await prisma.courseTopic.create({
        data: {
          courseId: args.courseId,
          name: candidate.name,
          origin: candidate.origin,
          reviewStatus: "SUGGESTED",
          confidence: candidate.confidence,
          generatedByJobId: args.jobId,
          // Left null on purpose: an unreviewed generated topic has no human
          // owner, and `createdBy` is what the TA own-only carve-out keys on.
          createdBy: null,
          sources: {
            create: candidate.materialIds.map((materialId) => ({ materialId })),
          },
        },
        select: { name: true },
      });
      created.push(topic.name);
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
  }

  return created;
}

function isUniqueViolation(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: unknown }).code === "P2002"
  );
}
