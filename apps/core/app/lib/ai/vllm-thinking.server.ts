/**
 * Adds request options the AI SDK can't set to every vLLM chat request:
 *
 * - Qwen3.5's chat-template option that turns thinking off
 *   (`chat_template_kwargs.enable_thinking: false`), unless
 *   `VLLM_DISABLE_THINKING` opts out.
 * - For a request that carries an image, a cap on the image's size in pixels
 *   (`mm_processor_kwargs.max_pixels`, `VLLM_IMAGE_MAX_PIXELS`, default
 *   1,500,000; `0` turns it off) (#1999). The server downscales anything
 *   bigger before the model sees it. A full-resolution phone photo is about
 *   16,400 image tokens, more than the 2B/9B's whole 16,384-token window, and
 *   made the 27B's transcription 2–3× slower; capped, any image is about
 *   1,600 tokens and reads as well (measured on prod, 2026-10-23).
 */
import { z } from "zod";

export const DEFAULT_VLLM_IMAGE_MAX_PIXELS = 1_500_000;

function thinkingDisabled(): boolean {
  const optOut = process.env.VLLM_DISABLE_THINKING?.trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(optOut ?? "");
}

/** The pixel cap for image requests, or null when it's turned off. */
export function vllmImageMaxPixels(): number | null {
  const raw = process.env.VLLM_IMAGE_MAX_PIXELS?.trim();
  if (raw === undefined || raw === "") return DEFAULT_VLLM_IMAGE_MAX_PIXELS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_VLLM_IMAGE_MAX_PIXELS;
  return value === 0 ? null : Math.floor(value);
}

/** The parts of an OpenAI-style chat body this wrapper reads. */
const chatBodySchema = z
  .object({
    messages: z
      .array(
        z
          .object({ content: z.union([z.string(), z.array(z.unknown()), z.null()]).optional() })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const imagePartSchema = z.object({ type: z.literal("image_url") }).passthrough();

/** Whether any message carries an image part. */
function hasImage(body: z.infer<typeof chatBodySchema>): boolean {
  return (body.messages ?? []).some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => imagePartSchema.safeParse(part).success),
  );
}

export function vllmThinkingDisabledFetch(): typeof fetch | undefined {
  const disableThinking = thinkingDisabled();
  const maxPixels = vllmImageMaxPixels();
  if (!disableThinking && maxPixels === null) return undefined;

  return async (input, init) => {
    const rawBody = z.string().safeParse(init?.body);
    if (init?.method === "POST" && rawBody.success && String(input).includes("/chat/completions")) {
      try {
        const parsed = chatBodySchema.safeParse(JSON.parse(rawBody.data));
        if (!parsed.success) return fetch(input, init);
        const body = parsed.data;

        if (disableThinking) {
          const chatTemplateKwargs = {
            ...z.record(z.unknown()).catch({}).parse(body.chat_template_kwargs),
            enable_thinking: false,
          };
          body.chat_template_kwargs = chatTemplateKwargs;
          const extraBody = z.record(z.unknown()).safeParse(body.extra_body);
          if (extraBody.success) {
            extraBody.data.chat_template_kwargs = {
              ...z.record(z.unknown()).catch({}).parse(extraBody.data.chat_template_kwargs),
              ...chatTemplateKwargs,
            };
            body.extra_body = extraBody.data;
          }
        }

        if (maxPixels !== null && hasImage(body)) {
          // A smaller cap already on the request wins; this only ever lowers it.
          const existing = z.record(z.unknown()).catch({}).parse(body.mm_processor_kwargs);
          const current = z.number().positive().safeParse(existing.max_pixels);
          body.mm_processor_kwargs = {
            ...existing,
            max_pixels: current.success ? Math.min(current.data, maxPixels) : maxPixels,
          };
        }

        return fetch(input, { ...init, body: JSON.stringify(body) });
      } catch (error) {
        console.warn(
          "[ai/vllm-thinking] Unable to inject vLLM request options; forwarding request unchanged.",
          error,
        );
      }
    }
    return fetch(input, init);
  };
}
