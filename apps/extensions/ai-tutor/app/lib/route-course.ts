import { z } from "zod";

const routeCourseSchema = z.object({
  course: z.object({ coreOfferingId: z.string().min(1).nullish() }),
});

export function getRouteCourseId(matches: readonly { data: unknown }[]): string | null {
  for (const match of matches) {
    const result = routeCourseSchema.safeParse(match.data);
    if (result.success && result.data.course.coreOfferingId) {
      return result.data.course.coreOfferingId;
    }
  }
  return null;
}
