import { z } from "zod";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { auth } from "~/lib/auth/server";
import {
  getUserProviderSettings,
  upsertUserProviderSetting,
  deleteUserProviderSetting,
} from "~/lib/user-provider-settings.server";
import prisma from "~/lib/prisma.server";

function unauthorized() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

/** GET — returns provider settings for the current user. Never exposes the raw key. */
export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return unauthorized();

  const rows = await prisma.userProviderSettings.findMany({
    where: { userId: session.user.id },
    select: {
      isEnabled: true,
      apiKey: true,
      baseUrl: true,
      provider: { select: { name: true } },
    },
  });

  const result = rows.map((row) => ({
    providerName: row.provider.name,
    isEnabled: row.isEnabled,
    hasKey: row.apiKey != null,
    baseUrl: row.baseUrl,
  }));

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const UpsertSchema = z.object({
  providerName: z.string().min(1),
  isEnabled: z.boolean(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});

const DeleteSchema = z.object({
  providerName: z.string().min(1),
});

/** POST to upsert, DELETE to remove. */
export async function action({ request }: ActionFunctionArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return unauthorized();

  if (request.method === "POST") {
    const body = await request.json();
    const parsed = UpsertSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    try {
      await upsertUserProviderSetting(session.user.id, parsed.data.providerName, {
        isEnabled: parsed.data.isEnabled,
        apiKey: parsed.data.apiKey,
        baseUrl: parsed.data.baseUrl,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith("Unknown provider")) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw err;
    }
    return new Response(null, { status: 204 });
  }

  if (request.method === "DELETE") {
    const body = await request.json();
    const parsed = DeleteSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    await deleteUserProviderSetting(session.user.id, parsed.data.providerName);
    return new Response(null, { status: 204 });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
}
