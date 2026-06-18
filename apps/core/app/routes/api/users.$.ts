import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { handleUsersApiRequest } = await import("~/lib/api/users-api.server");
  return handleUsersApiRequest(request);
}

export async function action({ request }: ActionFunctionArgs) {
  const { handleUsersApiRequest } = await import("~/lib/api/users-api.server");
  return handleUsersApiRequest(request);
}
