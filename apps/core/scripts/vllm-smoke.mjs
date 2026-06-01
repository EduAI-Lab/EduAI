#!/usr/bin/env node
/**
 * Smoke test vLLM OpenAI-compatible API.
 *
 *   VLLM_BASE_URL=http://cmps01.ok.ubc.ca:8000 node ./scripts/vllm-smoke.mjs
 *   VLLM_MODEL=qwen2.5-7b-instruct node ./scripts/vllm-smoke.mjs
 */

const base = (process.env.VLLM_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const apiKey = process.env.VLLM_API_KEY || "vllm-local";
const model = process.env.VLLM_MODEL || "qwen2.5-7b-instruct";

async function main() {
  const modelsRes = await fetch(`${base}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  console.log("GET /v1/models", modelsRes.status);
  if (modelsRes.ok) {
    const body = await modelsRes.json();
    console.log(JSON.stringify(body, null, 2));
  } else {
    console.log(await modelsRes.text());
  }

  const t0 = performance.now();
  const chatRes = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Say hi in one word." }],
      max_tokens: 32,
      stream: false,
    }),
  });
  const elapsed = Math.round(performance.now() - t0);
  console.log("\nPOST /v1/chat/completions", chatRes.status, `(${elapsed} ms wall)`);

  const text = await chatRes.text();
  try {
    const json = JSON.parse(text);
    const content = json.choices?.[0]?.message?.content;
    console.log("reply:", content);
    console.log("usage:", json.usage);
  } catch {
    console.log(text.slice(0, 500));
  }

  if (!chatRes.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
