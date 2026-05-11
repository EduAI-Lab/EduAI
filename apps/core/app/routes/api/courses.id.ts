import { handleCourseRequest } from "~/lib/courses/server";

export async function action({ request }: { request: Request }) {
  return handleCourseRequest(request);
}
