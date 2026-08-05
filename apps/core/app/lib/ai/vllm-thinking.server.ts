/**
 * Adds Qwen3.5's OpenAI-compatible chat-template option to every vLLM chat
 * request. The AI SDK does not expose this field as a model provider option.
 */
export function vllmThinkingDisabledFetch(): typeof fetch | undefined {
  if (process.env.VLLM_DISABLE_THINKING === "0") return undefined;

  return async (input, init) => {
    if (
      init?.method === "POST" &&
      typeof init.body === "string" &&
      String(input).includes("/chat/completions")
    ) {
      try {
        const body = JSON.parse(init.body);
        body.chat_template_kwargs = {
          ...body.chat_template_kwargs,
          enable_thinking: false,
        };
        return fetch(input, { ...init, body: JSON.stringify(body) });
      } catch {
        // Malformed body — fall through to the unmodified request.
      }
    }
    return fetch(input, init);
  };
}
