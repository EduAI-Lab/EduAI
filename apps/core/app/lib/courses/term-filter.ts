export type TermBucket = "all" | "t1" | "t2";

const T1_TERMS = new Set(["fall", "winter", "t1", "term 1", "term1"]);
const T2_TERMS = new Set(["spring", "summer", "t2", "term 2", "term2"]);

export function normalizeTerm(term: string): string {
  return term.trim().toLowerCase();
}

export function termBucketFor(term: string): "t1" | "t2" | null {
  const normalized = normalizeTerm(term);
  if (T1_TERMS.has(normalized)) return "t1";
  if (T2_TERMS.has(normalized)) return "t2";
  return null;
}

export function courseMatchesTermBucket(
  course: { term: string },
  bucket: TermBucket,
): boolean {
  if (bucket === "all") return true;
  const mapped = termBucketFor(course.term);
  if (mapped === null) return false;
  return mapped === bucket;
}

export function filterCoursesByTermBucket<T extends { term: string }>(
  courses: T[],
  bucket: TermBucket,
): T[] {
  return courses.filter((course) => courseMatchesTermBucket(course, bucket));
}
