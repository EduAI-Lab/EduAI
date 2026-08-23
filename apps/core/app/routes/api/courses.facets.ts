import type { LoaderFunctionArgs } from "react-router";
import { getCourseFacets } from "~/lib/courses/server";

export async function loader({ request }: LoaderFunctionArgs) {
  return getCourseFacets(request);
}
