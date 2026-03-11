import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  createOAuthClientSchema,
  createSisterAppClient,
  json,
  listSisterAppClients,
  requireAdminSession,
} from "~/lib/auth/oauth-clients.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    await requireAdminSession(request);
    return json(await listSisterAppClients(request));
  } catch (response) {
    if (response instanceof Response) {
      return response;
    }
    throw response;
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    await requireAdminSession(request);
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const body = createOAuthClientSchema.safeParse(await request.json());
    if (!body.success) {
      return json({ error: body.error.flatten() }, { status: 400 });
    }

    const client = await createSisterAppClient(request, body.data);
    return json(client, { status: 201 });
  } catch (response) {
    if (response instanceof Response) {
      return response;
    }
    throw response;
  }
}
