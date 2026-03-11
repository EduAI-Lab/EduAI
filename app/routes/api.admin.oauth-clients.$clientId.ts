import type { ActionFunctionArgs } from "react-router";

import {
  deleteSisterAppClient,
  json,
  requireAdminSession,
  updateOAuthClientSchema,
  updateSisterAppClient,
} from "~/lib/auth/oauth-clients.server";

type Params = {
  clientId?: string;
};

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    await requireAdminSession(request);
    const { clientId } = params as Params;
    if (!clientId) {
      return json({ error: "Missing client id" }, { status: 400 });
    }

    if (request.method === "PATCH") {
      const body = updateOAuthClientSchema.safeParse(await request.json());
      if (!body.success) {
        return json({ error: body.error.flatten() }, { status: 400 });
      }

      return json(await updateSisterAppClient(request, clientId, body.data));
    }

    if (request.method === "DELETE") {
      return json(await deleteSisterAppClient(request, clientId));
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (response) {
    if (response instanceof Response) {
      return response;
    }
    throw response;
  }
}
