import { searchDisciplines } from "~/lib/disciplines/server";
import type { LoaderFunctionArgs } from "react-router";

/** GET /api/disciplines/search?q= — typeahead over discipline code + name (§541). */
export async function loader({ request }: LoaderFunctionArgs) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return searchDisciplines(request, q);
}
