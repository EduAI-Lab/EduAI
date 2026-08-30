import type { LoaderFunctionArgs } from "react-router";
import { getCourseFacets } from "~/lib/courses/server";
import { withErrorResponse } from "~/lib/errors.server";

export async function loader({ request }: LoaderFunctionArgs) {
  return withErrorResponse(
    async () => {
      return getCourseFacets(request);
    },
    { request },
  );
}
