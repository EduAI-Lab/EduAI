import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = process.env.EDUAI_ENV_FILE || path.join(root, "apps/core/.env");

function readEnv(name) {
  const text = fs.readFileSync(envPath, "utf8");
  const match = text.match(new RegExp(`^${name}="?([^"\\n]+)"?`, "m"));
  return match?.[1]?.trim() || "";
}

const eduaiKey = readEnv("EDUAI_API_KEY");
const openRouterKey = readEnv("OPENROUTER_API_KEY");
const baseUrl = (process.argv[2] || "https://dev.eduai.ok.ubc.ca").replace(/\/$/, "");
const model =
  process.argv[3] || "openrouter:google/gemini-2.5-flash";

if (!eduaiKey) {
  console.error("EDUAI_API_KEY missing in apps/core/.env");
  process.exit(1);
}
if (!openRouterKey) {
  console.error("OPENROUTER_API_KEY missing in apps/core/.env");
  process.exit(1);
}

const payload = {
  messages: [
    {
      role: "user",
      content: "Reply with exactly one word: pong",
    },
  ],
  model,
  apiKeys: {
    openrouter: { apiKey: openRouterKey, isEnabled: true },
  },
  streaming: false,
};

console.log(`POST ${baseUrl}/api/chat model=${model}`);

const res = await fetch(`${baseUrl}/api/chat`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${eduaiKey}`,
  },
  body: JSON.stringify(payload),
});

const body = await res.text();
console.log(`status=${res.status}`);
console.log(body.slice(0, 2000));

if (!res.ok) {
  process.exit(1);
}
