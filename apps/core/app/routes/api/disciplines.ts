import { listDisciplines } from "~/lib/disciplines/server";
import type { LoaderFunctionArgs } from "react-router";

/** GET /api/disciplines — full discipline list (§541). */
export async function loader({ request }: LoaderFunctionArgs) {
  return listDisciplines(request);
}
