import type { CourseMaterial } from "~/hooks/api/use-course-materials";

type MaterialsPage = { materials: CourseMaterial[]; nextCursor: string | null };

/** The most rows the materials API returns per page. */
const PAGE_LIMIT = 100;
/** A course with more files than this is listed only this far in the topic file picker. */
export const MAX_LISTED_COURSE_FILES = 1_000;

async function readPage(url: string): Promise<MaterialsPage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Loading files failed (${res.status})`);
  // SAFETY: the materials route's list shape, the one `useCourseMaterials` reads.
  return (await res.json()) as MaterialsPage;
}

/** Specific files with their current topics, whether or not the page loaded them. */
export async function fetchCourseMaterialsByIds(
  courseId: string,
  ids: string[],
): Promise<CourseMaterial[]> {
  if (ids.length === 0) return [];
  const query = encodeURIComponent(ids.join(","));
  return (await readPage(`/api/courses/${encodeURIComponent(courseId)}/materials?ids=${query}`))
    .materials;
}

/**
 * Every file of the course, page by page (#1997): the Materials tab loads them
 * a page at a time, but linking files to a topic has to offer all of them.
 * `truncated` is true when the course has more than `MAX_LISTED_COURSE_FILES`.
 */
export async function fetchAllCourseMaterials(
  courseId: string,
): Promise<{ materials: CourseMaterial[]; truncated: boolean }> {
  const materials: CourseMaterial[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (cursor) params.set("cursor", cursor);
    const page = await readPage(`/api/courses/${encodeURIComponent(courseId)}/materials?${params}`);
    materials.push(...page.materials);
    cursor = page.nextCursor;
  } while (cursor && materials.length < MAX_LISTED_COURSE_FILES);
  return { materials, truncated: cursor !== null };
}
