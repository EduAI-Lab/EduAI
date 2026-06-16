import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import {
  getWebToolsEnabled,
  setWebToolsEnabled,
  WEB_TOOLS_CONFIG_KEY,
} from "~/lib/system-config.server";
import { z } from "zod";

const UpdateWebToolsSchema = z.object({
  webToolsEnabled: z.boolean(),
});

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const key = url.pathname.split("/").pop();

  if (key !== WEB_TOOLS_CONFIG_KEY) {
    return new Response(JSON.stringify({ error: "Unknown config key" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const session = await auth.api.getSession(request);
  if (!session?.user || session.user.role !== "ADMIN") {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const webToolsEnabled = await getWebToolsEnabled();
  return new Response(JSON.stringify({ webToolsEnabled }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const url = new URL(request.url);
  const key = url.pathname.split("/").pop();

  if (key !== WEB_TOOLS_CONFIG_KEY) {
    return new Response(JSON.stringify({ error: "Unknown config key" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  const session = apiKeySession ?? (await auth.api.getSession(request));
  if (!session?.user || session.user.role !== "ADMIN") {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (request.method !== "PATCH" && request.method !== "PUT") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await request.json();
  const parsed = UpdateWebToolsSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid input", details: parsed.error.flatten() }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  await setWebToolsEnabled(parsed.data.webToolsEnabled, session.user.id);

  return new Response(
    JSON.stringify({ webToolsEnabled: parsed.data.webToolsEnabled }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
