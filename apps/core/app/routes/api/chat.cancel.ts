import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  cancelActiveChat,
  isValidActiveChatRequestId,
} from "~/lib/ai/active-chat-cancellations.server";

const cancellationSchema = z.object({ requestId: z.string() });

/**
 * Explicitly terminates an active chat stream when a reverse proxy masks the
 * browser disconnect from the Core process. The request id is a client-created
 * UUID and maps only to a short-lived, in-memory cancellation handle.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  const parsed = cancellationSchema.safeParse(body);
  if (!parsed.success || !isValidActiveChatRequestId(parsed.data.requestId)) {
    return new Response(null, { status: 400 });
  }

  cancelActiveChat(parsed.data.requestId);
  // Both a completed/unknown id and a cancelled one are successful from the
  // UI's perspective: Stop is idempotent and must not expose stream state.
  return new Response(null, { status: 204 });
}
