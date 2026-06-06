import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { search } = new URL(request.url);
  return redirect(`/auth/login${search}`);
}
