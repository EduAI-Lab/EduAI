/**
 * Smoke-test embedding provider config (local Ollama or cloud chain).
 * Run from apps/core: npm run test:embedding
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  generateEmbedding,
  getExpectedEmbeddingDimension,
  wantsLocalEmbeddingProvider,
} from "../app/lib/ai/embedding";

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

function describeProvider(): string {
  if (wantsLocalEmbeddingProvider()) return "local (ollama)";
  if (process.env.OPENROUTER_API_KEY?.trim()) return "openrouter";
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) return "google";
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  return "none";
}

async function main() {
  loadEnvFile();

  const provider = describeProvider();
  const expectedDim = getExpectedEmbeddingDimension();

  console.log("Embedding provider mode:", provider);
  console.log("Expected dimension:", expectedDim);

  if (provider === "none") {
    console.error(
      "Set EMBEDDING_PROVIDER=local (with Ollama) or a cloud key (OPENROUTER_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, OPENAI_API_KEY) in apps/core/.env",
    );
    process.exit(1);
  }

  const vector = await generateEmbedding("hello from EduAI embedding test");
  console.log("ok — vector length:", vector.length);
  if (vector.length !== expectedDim) {
    console.warn(
      `Warning: vector length ${vector.length} does not match expected ${expectedDim} (EMBEDDING_DIMENSION / pgvector column).`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Embedding test failed:", err);
  process.exit(1);
});
