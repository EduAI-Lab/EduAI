import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { withErrorResponse } from "~/lib/errors.server";

/**
 * Wrapped in `withErrorResponse` (#1279): the handler answers every case it
 * anticipates with `apiError(...)`, but anything it does not — a Prisma failure
 * mid-transaction, a dropped connection — used to escape the loader entirely
 * and be rendered by React Router rather than by this API's envelope. The
 * mapper turns those into the same `{ error: "CODE" }` shape every other
 * response on this route uses.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  return withErrorResponse(async () => {
    const { handleAiModelsApiRequest } = await import("~/lib/api/ai-models-api.server");
    return handleAiModelsApiRequest(request);
  });
}

export async function action({ request }: ActionFunctionArgs) {
  return withErrorResponse(async () => {
    const { handleAiModelsApiRequest } = await import("~/lib/api/ai-models-api.server");
    return handleAiModelsApiRequest(request);
  });
}
