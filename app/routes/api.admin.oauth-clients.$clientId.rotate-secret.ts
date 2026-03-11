import type { ActionFunctionArgs } from "react-router";

import { json, requireAdminSession, rotateSisterAppClientSecret } from "~/lib/auth/oauth-clients.server";

type Params = {
  clientId?: string;
};

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    await requireAdminSession(request);
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const { clientId } = params as Params;
    if (!clientId) {
      return json({ error: "Missing client id" }, { status: 400 });
    }

    return json(await rotateSisterAppClientSecret(request, clientId));
  } catch (response) {
    if (response instanceof Response) {
      return response;
    }
    throw response;
  }
}
