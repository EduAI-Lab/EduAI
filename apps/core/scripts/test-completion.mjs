/**
 * Smoke-test POST /api/completion (#858) against a local or remote Core instance.
 *
 * Required env (or loaded from apps/core/.env):
 *   COMPLETION_TEST_URL     default http://127.0.0.1:3000/api/completion
 *   EDUAI_API_KEY           service key (Authorization: Bearer)
 *   GOOGLE_GENERATIVE_AI_API_KEY  forwarded in apiKeys.google for the model call
 *
 * Usage:
 *   cd apps/core && node ./scripts/test-completion.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const url = process.env.COMPLETION_TEST_URL ?? "http://127.0.0.1:3000/api/completion";
const serviceKey = process.env.EDUAI_API_KEY;
const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

if (!serviceKey) {
  console.error("Missing EDUAI_API_KEY in apps/core/.env");
  process.exit(1);
}
if (!googleKey) {
  console.error("Missing GOOGLE_GENERATIVE_AI_API_KEY in apps/core/.env");
  process.exit(1);
}

const body = {
  systemPrompt:
    "You are a question generator. Reply with valid JSON only: {\"ok\": true, \"message\": \"completion works\"}",
  messages: [{ role: "user", content: "Confirm the endpoint works." }],
  model: "google:gemini-2.5-flash",
  apiKeys: { google: { apiKey: googleKey, isEnabled: true } },
  streaming: false,
  temperature: 0.2,
};

console.log(`POST ${url}`);

const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${serviceKey}`,
  },
  body: JSON.stringify(body),
});

const text = await res.text();
console.log(`Status: ${res.status}`);

if (!res.ok) {
  console.error(text);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(text);
} catch {
  console.error("Non-JSON response:", text.slice(0, 500));
  process.exit(1);
}

console.log("Response keys:", Object.keys(data));
console.log("Content preview:", String(data.content ?? "").slice(0, 300));
console.log("OK — /api/completion responded successfully.");
