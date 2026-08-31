export function getRouteCourseId(matches: readonly { data: unknown }[]): string | null {
  for (const match of matches) {
    if (typeof match.data !== "object" || match.data === null || !("course" in match.data))
      continue;
    const course = match.data.course;
    if (typeof course !== "object" || course === null || !("coreOfferingId" in course)) continue;
    const id = course.coreOfferingId;
    if (typeof id === "string" && id) return id;
  }
  return null;
}
