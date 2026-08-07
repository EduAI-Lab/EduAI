import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { handleAiProvidersApiRequest } = await import("~/lib/api/ai-providers-api.server");
  return handleAiProvidersApiRequest(request);
}

export async function action({ request }: ActionFunctionArgs) {
  const { handleAiProvidersApiRequest } = await import("~/lib/api/ai-providers-api.server");
  return handleAiProvidersApiRequest(request);
}
