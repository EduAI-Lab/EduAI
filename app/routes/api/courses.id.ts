import { updateCourse } from "~/lib/courses/update";

export async function action({ request, params }: { request: Request, params: { id: string } }) {
  const courseId = params.id;
  return updateCourse(request, courseId);
}
