/**
 * Adds Qwen3.5's OpenAI-compatible chat-template option to every vLLM chat
 * request. The AI SDK does not expose this field as a model provider option.
 */
import { z } from "zod";

export function vllmThinkingDisabledFetch(): typeof fetch | undefined {
  const optOut = process.env.VLLM_DISABLE_THINKING?.trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(optOut ?? "")) return undefined;

  return async (input, init) => {
    const rawBody = z.string().safeParse(init?.body);
    if (init?.method === "POST" && rawBody.success && String(input).includes("/chat/completions")) {
      try {
        const body = JSON.parse(rawBody.data);
        const chatTemplateKwargs = {
          ...body.chat_template_kwargs,
          enable_thinking: false,
        };
        body.chat_template_kwargs = chatTemplateKwargs;
        if (z.record(z.unknown()).safeParse(body.extra_body).success) {
          body.extra_body.chat_template_kwargs = {
            ...body.extra_body.chat_template_kwargs,
            ...chatTemplateKwargs,
          };
        }
        return fetch(input, { ...init, body: JSON.stringify(body) });
      } catch (error) {
        console.warn(
          "[ai/vllm-thinking] Unable to inject chat_template_kwargs; forwarding request unchanged.",
          error,
        );
      }
    }
    return fetch(input, init);
  };
}
