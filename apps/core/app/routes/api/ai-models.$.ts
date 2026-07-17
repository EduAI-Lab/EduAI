import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { handleAiModelsApiRequest } = await import("~/lib/api/ai-models-api.server");
  return handleAiModelsApiRequest(request);
}

export async function action({ request }: ActionFunctionArgs) {
  const { handleAiModelsApiRequest } = await import("~/lib/api/ai-models-api.server");
  return handleAiModelsApiRequest(request);
}
