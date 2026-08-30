import { listDisciplines } from "~/lib/disciplines/server";
import type { LoaderFunctionArgs } from "react-router";
import { withErrorResponse } from "~/lib/errors.server";

/** GET /api/disciplines — full discipline list (§541). */
export async function loader({ request }: LoaderFunctionArgs) {
  return withErrorResponse(
    async () => {
      return listDisciplines(request);
    },
    { request },
  );
}
