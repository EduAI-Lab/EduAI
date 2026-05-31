/**
 * Smoke-test embedding provider config (OpenRouter → Google → OpenAI).
 * Run from apps/core: npm run test:embedding
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { generateEmbedding } from "../app/lib/ai/embedding";

function loadEnvFile() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main() {
  loadEnvFile();

  const provider = process.env.OPENROUTER_API_KEY?.trim()
    ? "openrouter"
    : process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()
      ? "google"
      : process.env.OPENAI_API_KEY?.trim()
        ? "openai"
        : "none";

  console.log("Embedding provider:", provider);
  if (provider === "none") {
    console.error(
      "Set OPENROUTER_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or OPENAI_API_KEY in apps/core/.env",
    );
    process.exit(1);
  }

  const vector = await generateEmbedding("hello from EduAI embedding test");
  console.log("ok — vector length:", vector.length);
  if (vector.length !== 3072) {
    console.warn(
      "Warning: expected 3072 dimensions for gemini-embedding-001 / pgvector column.",
    );
  }
}

main().catch((err) => {
  console.error("Embedding test failed:", err);
  process.exit(1);
});
