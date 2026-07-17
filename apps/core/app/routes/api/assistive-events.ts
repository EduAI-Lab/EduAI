import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { auth } from "~/lib/auth/server";
import {
  ASSISTIVE_CLIENT_EVENT_TYPES,
  isAssistiveClientEventType,
  recordAssistiveEvent,
  sanitizeClientMetrics,
} from "~/lib/assistive-events.server";
import prisma from "~/lib/prisma.server";

const bodySchema = z.object({
  eventType: z.string().min(1).max(64),
  adhdAssist: z.boolean().optional(),
  chatId: z.string().cuid().optional(),
  metrics: z.unknown().optional(),
});

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "VALIDATION_ERROR", fields: { body: "invalid JSON" } }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors }),
      { status: 422, headers: { "Content-Type": "application/json" } },
    );
  }

  const { eventType, chatId, metrics } = parsed.data;
  if (!isAssistiveClientEventType(eventType)) {
    return new Response(
      JSON.stringify({
        error: "VALIDATION_ERROR",
        fields: {
          eventType: `Must be one of: ${ASSISTIVE_CLIENT_EVENT_TYPES.join(", ")}`,
        },
      }),
      { status: 422, headers: { "Content-Type": "application/json" } },
    );
  }

  if (chatId) {
    const chat = await prisma.chat.findFirst({
      where: { id: chatId, userId: session.user.id },
      select: { id: true, adhdAssist: true },
    });
    if (!chat) {
      return new Response(JSON.stringify({ error: "CHAT_NOT_FOUND" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    await recordAssistiveEvent({
      userId: session.user.id,
      chatId: chat.id,
      adhdAssist: parsed.data.adhdAssist ?? chat.adhdAssist,
      eventType,
      metricsJson: sanitizeClientMetrics(metrics),
    });
  } else {
    await recordAssistiveEvent({
      userId: session.user.id,
      chatId: null,
      adhdAssist: parsed.data.adhdAssist ?? false,
      eventType,
      metricsJson: sanitizeClientMetrics(metrics),
    });
  }

  return new Response(null, { status: 201 });
}
