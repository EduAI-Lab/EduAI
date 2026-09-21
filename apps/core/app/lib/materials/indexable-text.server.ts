import { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";

/**
 * Whether a failed material still holds text a retry could index (#1749).
 *
 * Two callers ask this about the same row and must never disagree: the
 * materials list, which decides whether to offer "Try again", and the reprocess
 * route, which decides whether to accept the click. They are kept in this one
 * file because they did drift — the list asked `rawText: { not: null }` while
 * the route asked `!material.rawText`, so a row with `rawText: ""` was offered
 * a button the route then refused with 409 (#1795 review).
 *
 * "Has text" is not "is not null". Before #1797 every text-free upload — an
 * image-only PDF scan, a figures-only DOCX, a blank `.txt` — was promoted with
 * `rawText: ""` and then failed at embedding, so those rows sit FAILED in every
 * existing course and this is the change that finally shows them a popover.
 * Whitespace-only text is the same story one level down: `generateChunks` trims
 * before it splits, so `" \n "` yields no chunks and `processMaterialEmbeddings`
 * throws "No content chunks generated". Neither shape can ever be re-indexed,
 * so neither is offered a retry.
 */
export function hasIndexableText(rawText: string | null | undefined): rawText is string {
  return (rawText ?? "").trim().length > 0;
}

/**
 * Which of `materialIds` still hold indexable text — `hasIndexableText` asked
 * of the database rather than of a row already in memory.
 *
 * Ids only, never the text: `rawText` is the whole document and must not be
 * materialized to answer a yes/no question about it (#948). Prisma has no
 * trimming filter, so the predicate is written as SQL instead of approximated
 * with `{ not: null }`; the approximation is exactly what let the two sides
 * disagree. `btrim` propagates NULL, so a null `rawText` drops out of the
 * result without needing a second clause.
 */
export async function selectMaterialIdsWithIndexableText(
  materialIds: string[],
): Promise<Set<string>> {
  if (materialIds.length === 0) return new Set<string>();

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "course_materials"
    WHERE "id" IN (${Prisma.join(materialIds)})
      AND btrim("rawText") <> ''
  `;
  return new Set(rows.map((row) => row.id));
}
