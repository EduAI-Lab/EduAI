/**
 * Dev-server smoke: OpenRouter chat provider registry + live model call.
 * Run from apps/core: npx tsx scripts/smoke-openrouter-chat-server.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateText } from "ai";
import { createAIProviderRegistry } from "../app/lib/ai/providers";

const coreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envText = fs.readFileSync(path.join(coreDir, ".env"), "utf8");
const openRouterKey = envText.match(/^OPENROUTER_API_KEY="?([^"\n]+)"?/m)?.[1]?.trim();

if (!openRouterKey) {
  console.error("OPENROUTER_API_KEY missing in apps/core/.env");
  process.exit(1);
}

const modelId = process.argv[2] || "openrouter:google/gemini-2.5-flash";
const registry = createAIProviderRegistry({
  openrouter: { apiKey: openRouterKey, isEnabled: true },
});

console.log(`model=${modelId}`);
const result = await generateText({
  model: registry.languageModel(modelId),
  prompt: "Reply with exactly one word: pong",
});

const text = result.text.trim();
console.log(`response=${text}`);
if (!text) {
  console.error("Empty response");
  process.exit(1);
}

console.log("openrouter-chat-smoke: OK");
