/**
 * @file The tutor half: context from the course or material the reader is
 * viewing (#1821).
 *
 * The page publishes a hint (`{ courseId, materialId? }`); everything here
 * re-derives access from the database for THIS reader. The hint widens nothing:
 *
 * - An invalid hint degrades the WHOLE context to none — a crafted value never
 *   reaches the content machinery even partially trusted. An empty hint means
 *   "nothing published yet", never "default to everything".
 * - Course access and the per-material read are the SAME rules the materials
 *   API applies (`canViewMaterial`, `readMaterialForViewer`) — one rule, not a
 *   second copy. A student gets material context only where the course shares
 *   its files with students (#2002) and is published — as the materials API
 *   lets them read those files — and never otherwise (#1962).
 * - A course whose instructor opted it out of the assistant contributes nothing.
 * - {@link buildMaterialContext} never throws: any failure degrades to "this
 *   material contributed nothing", so an unreadable material can never be the
 *   reason a documentation question goes unanswered.
 *
 * Core's student UI renders no quiz or question-bank content, so none is loaded
 * here; the projection is the material title plus the same preview excerpt the
 * student UI shows, and nothing else from the row.
 */
import { z } from "zod";

import { findRelevantContent } from "~/lib/ai/embedding";
import {
  MATERIAL_BLOCK_MAX_CHARS,
  MATERIAL_FIELD_MAX_CHARS,
  TRUNCATION_MARKER,
  capContents,
  truncateWithMarker,
} from "~/lib/assistant/context-caps";
import { resolveCourseAccessGate, type AccessLevel } from "~/lib/auth/course-access.server";
import { previewExcerpt, readMaterialForViewer } from "~/lib/materials/viewable-material.server";
import { canViewMaterial } from "~/lib/rbac/permissions";
import prisma from "~/lib/prisma.server";

/** What the page says the reader is looking at. A hint, never an authorization. */
export type PageContextHint = { courseId: string; materialId: string | null };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const hintSchema = z
  .object({
    courseId: z.string().regex(ID_PATTERN),
    materialId: z.string().regex(ID_PATTERN).optional(),
  })
  .strict();

/**
 * The request's context record → a hint, or null. Unknown keys, a malformed id,
 * or a material without a course all degrade the whole hint to null.
 */
export function parsePageContextHint(
  raw: Record<string, string> | null | undefined,
): PageContextHint | null {
  if (!raw || Object.keys(raw).length === 0) return null;
  const parsed = hintSchema.safeParse(raw);
  if (!parsed.success) return null;
  return { courseId: parsed.data.courseId, materialId: parsed.data.materialId ?? null };
}

export type PageContextResolution =
  | { kind: "none" }
  /** The hint names a course or material that does not exist — no material context. */
  | { kind: "missing" }
  | {
      kind: "resolved";
      courseId: string;
      courseLabel: string;
      /** Course-level opt-out (`Course.aiAssistantEnabled`). */
      courseAllowsAi: boolean;
      access: AccessLevel | null;
      /** This reader may see the course's materials at all. */
      canView: boolean;
      /** Set when the hint named a material this reader may see. */
      material: { id: string; title: string; status: string; rawText: string | null } | null;
    };

type ResolvedPageContext = Extract<PageContextResolution, { kind: "resolved" }>;

/**
 * The course-level resolution from a course and access the caller already
 * resolved for this reader — the course page loader has both in hand.
 */
export async function resolveCourseContext(input: {
  course: {
    id: string;
    code: string;
    name: string;
    aiAssistantEnabled: boolean;
    studentFilesVisible: boolean;
    isPublished: boolean;
  };
  access: AccessLevel | null;
}): Promise<ResolvedPageContext> {
  const { course, access } = input;
  // The materials API's read gate, publish check included (#2002).
  const canView =
    access !== null &&
    canViewMaterial(access.level, course.studentFilesVisible) &&
    (access.level !== "student" || course.isPublished);
  return {
    kind: "resolved",
    courseId: course.id,
    courseLabel: `${course.code} — ${course.name}`,
    courseAllowsAi: course.aiAssistantEnabled,
    access,
    canView,
    material: null,
  };
}

/** Re-derive what the hint points at, for this reader. */
export async function resolvePageContext(
  user: { id: string; role?: string | null },
  hint: PageContextHint | null,
): Promise<PageContextResolution> {
  if (!hint) return { kind: "none" };

  const { course, access } = await resolveCourseAccessGate(user, hint.courseId);
  if (!course || course.deletedAt) return { kind: "missing" };

  const details = await prisma.course.findUnique({
    where: { id: course.id },
    select: { code: true, name: true, aiAssistantEnabled: true },
  });
  if (!details) return { kind: "missing" };

  const resolved = await resolveCourseContext({ course: { ...course, ...details }, access });
  let { canView } = resolved;
  let material: ResolvedPageContext["material"] = null;
  if (hint.materialId && canView && access) {
    const read = await readMaterialForViewer({
      courseId: course.id,
      materialId: hint.materialId,
      access,
    });
    if (read.status === "missing") return { kind: "missing" };
    if (read.status === "hidden") {
      // A student looking at something they may not see gets nothing from it —
      // not even the rest of the course, since the hint was about this material.
      canView = false;
    } else {
      material = {
        id: read.material.id,
        title: read.material.title,
        status: read.material.status,
        rawText: read.material.rawText,
      };
    }
  }

  return { ...resolved, canView, material };
}

export type MaterialSource = { id: string; title: string; url: string };

export type MaterialContext =
  | { status: "ok"; block: string; label: string; sources: MaterialSource[] }
  /** Ran, but nothing relevant or readable was there. */
  | { status: "empty"; label: string }
  /** Could not be loaded — transient, and reported differently from "nothing there". */
  | { status: "failed"; label: string };

/** The label the panel header and the prompt use for the active scope. */
export function scopeLabel(resolution: Extract<PageContextResolution, { kind: "resolved" }>) {
  return resolution.material
    ? `${resolution.material.title} (${resolution.courseLabel})`
    : resolution.courseLabel;
}

function courseUrl(courseId: string) {
  return `/courses/${encodeURIComponent(courseId)}`;
}

/** Project one material to the only fields the model may see. */
export function projectMaterialBlock(material: { title: string; rawText: string | null }): string {
  const { excerpt, truncated } = previewExcerpt(material.rawText);
  const body = truncateWithMarker(excerpt, MATERIAL_FIELD_MAX_CHARS);
  const marker = truncated && !body.truncated ? `\n${TRUNCATION_MARKER}` : "";
  return `Material: ${material.title}\n\n${body.text}${marker}`;
}

/**
 * Build the material block for an answer. Callers must already have decided,
 * through the gate, that the material source applies. Never throws.
 */
export async function buildMaterialContext(input: {
  resolution: Extract<PageContextResolution, { kind: "resolved" }>;
  query: string;
}): Promise<MaterialContext> {
  const { resolution } = input;
  const label = scopeLabel(resolution);
  try {
    if (resolution.material) {
      if (resolution.material.status !== "READY" || !resolution.material.rawText?.trim()) {
        return { status: "empty", label };
      }
      return {
        status: "ok",
        label,
        block: projectMaterialBlock(resolution.material),
        sources: [
          {
            id: `material:${resolution.material.id}`,
            title: resolution.material.title,
            url: courseUrl(resolution.courseId),
          },
        ],
      };
    }

    // Course page with no material open: the course's own retrieval, with the
    // student visibility filters exactly as course chat applies them.
    const hits = await findRelevantContent(
      input.query,
      resolution.courseId,
      6,
      undefined,
      resolution.access?.level === "student",
    );
    if (hits.length === 0) return { status: "empty", label };
    const capped = capContents(
      hits.map((hit) => ({ title: hit.materialTitle, content: hit.content })),
      { perItem: MATERIAL_FIELD_MAX_CHARS, total: MATERIAL_BLOCK_MAX_CHARS },
    );
    const block = capped.map((hit) => `From "${hit.title}":\n${hit.content}`).join("\n\n");
    const titles = [...new Set(capped.map((hit) => hit.title))];
    return {
      status: "ok",
      label,
      block: `Course: ${resolution.courseLabel}\n\n${block}`,
      sources: titles.map((title) => ({
        id: `course:${resolution.courseId}:${title}`,
        title,
        url: courseUrl(resolution.courseId),
      })),
    };
  } catch (cause) {
    console.warn("[assistant/material] material context failed; continuing without it", {
      courseId: resolution.courseId,
      error: cause instanceof Error ? cause.name : "unknown",
    });
    return { status: "failed", label };
  }
}
