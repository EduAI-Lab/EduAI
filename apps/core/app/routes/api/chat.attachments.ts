import type { ActionFunctionArgs } from "react-router";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { checkRateLimit, parseEnvInt } from "~/lib/auth/rate-limit.server";
import {
  ChatAttachmentError,
  extractChatAttachment,
  type ChatAttachmentExtraction,
  resolveChatAttachmentLimits,
} from "~/lib/chat/attachment-extraction.server";
import { MultipartBodyTooLargeError, readBoundedFormData } from "~/lib/multipart.server";

/** Multipart framing around the file itself (boundaries, part headers). */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

type JsonBody = Record<string, string | number | boolean>;

const json = (
  status: number,
  body: JsonBody | ChatAttachmentExtraction,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const missingFile = () => json(400, { error: "No file was attached.", code: "ATTACHMENT_MISSING" });

/**
 * POST /api/chat/attachments — turns one uploaded file into capped plain text
 * for a chat message (#1902). Stores nothing: the client puts the returned
 * text on the message as a `text/plain` attachment and `/api/chat` validates
 * it again on send. Browser sessions only; no service-key caller has an
 * attachment UI.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }

  const session = await getRequestSession(request);
  if (!session?.user) return json(401, { error: "Unauthorized" });

  const rate = await checkRateLimit(
    `chat-attachment:${session.user.id}`,
    parseEnvInt(process.env.CHAT_ATTACHMENT_RATE_LIMIT, 20),
    parseEnvInt(process.env.CHAT_ATTACHMENT_RATE_WINDOW_MS, 60_000),
  );
  if (rate.limited) {
    return json(
      429,
      {
        error: "You're attaching files too quickly. Wait a moment and try again.",
        code: "RATE_LIMITED",
      },
      { "Retry-After": String(rate.retryAfter) },
    );
  }

  const limits = resolveChatAttachmentLimits();
  let form: FormData;
  try {
    form = await readBoundedFormData(request, limits.maxBytes + MULTIPART_OVERHEAD_BYTES);
  } catch (error) {
    if (error instanceof MultipartBodyTooLargeError) {
      const tooLarge = new ChatAttachmentError("ATTACHMENT_TOO_LARGE");
      return json(tooLarge.status, { error: tooLarge.message, code: tooLarge.code });
    }
    // Invalid, empty, or non-multipart bodies (formData() throws a TypeError)
    // are all a client mistake, never a 500.
    return missingFile();
  }

  const file = form.get("file");
  if (!(file instanceof File)) return missingFile();

  try {
    return json(200, await extractChatAttachment(file, limits));
  } catch (error) {
    if (error instanceof ChatAttachmentError) {
      return json(error.status, { error: error.message, code: error.code });
    }
    console.error("chat attachment extraction failed", error);
    const failed = new ChatAttachmentError("ATTACHMENT_EXTRACT_FAILED");
    return json(failed.status, { error: failed.message, code: failed.code });
  }
}
