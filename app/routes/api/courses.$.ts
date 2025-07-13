import { handleCourseRequest } from "~/lib/courses/server";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  return handleCourseRequest(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return handleCourseRequest(request);
}
