/**
 * Idempotent upsert of AI providers, models, and routing tier assignments.
 * Safe to run on every dev start (existing DB with users).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ROUTING_TIER_ASSIGNMENTS = [
  {
    providerName: "vllm",
    modelId: "qwen2.5-7b-instruct",
    routerTier: "TIER_1" as const,
    estEnergyJoulesPerToken: 0.08,
    averageCarbonGramsPerToken: 1.78e-6,
  },
  {
    providerName: "google",
    modelId: "gemini-2.5-flash",
    routerTier: "TIER_2" as const,
    estEnergyJoulesPerToken: 0.3,
    averageCarbonGramsPerToken: 2.0e-5,
  },
  {
    providerName: "vllm",
    modelId: "qwen2.5-32b-instruct",
    routerTier: "TIER_3" as const,
    estEnergyJoulesPerToken: 0.5,
    averageCarbonGramsPerToken: 1.11e-5,
  },
];

async function applyRoutingTierAssignments() {
  for (const row of ROUTING_TIER_ASSIGNMENTS) {
    const provider = await prisma.aIProvider.findUnique({
      where: { name: row.providerName },
    });
    if (!provider) continue;

    const result = await prisma.aIModel.updateMany({
      where: { providerId: provider.id, modelId: row.modelId },
      data: {
        routerTier: row.routerTier,
        estEnergyJoulesPerToken: row.estEnergyJoulesPerToken,
        averageCarbonGramsPerToken: row.averageCarbonGramsPerToken,
      },
    });

    if (result.count === 0) {
      console.warn(`  No AIModel row for ${row.providerName}:${row.modelId}`);
    }
  }
}

async function main() {
  console.log("[sync-ai-providers] Upserting providers and models...");

  const openai = await prisma.aIProvider.upsert({
    where: { name: "openai" },
    update: { isActive: true },
    create: {
      name: "openai",
      displayName: "OpenAI",
      description: "GPT family of models",
      requiresApiKey: true,
      envVarName: "OPENAI_API_KEY",
      isActive: true,
    },
  });

  const google = await prisma.aIProvider.upsert({
    where: { name: "google" },
    update: { isActive: true },
    create: {
      name: "google",
      displayName: "Google AI",
      description: "Gemini models",
      requiresApiKey: true,
      envVarName: "GOOGLE_GENERATIVE_AI_API_KEY",
      isActive: true,
    },
  });

  await prisma.aIProvider.upsert({
    where: { name: "ollama" },
    update: { isActive: true },
    create: {
      name: "ollama",
      displayName: "Ollama",
      description: "Local AI models",
      requiresApiKey: false,
      defaultBaseUrl: "http://localhost:11434/api",
      envVarName: "OLLAMA_BASE_URL",
      isActive: true,
    },
  });

  const vllm = await prisma.aIProvider.upsert({
    where: { name: "vllm" },
    update: {
      isActive: true,
      displayName: "vLLM",
      description: "Local OpenAI-compatible inference (cmps01)",
      requiresApiKey: false,
      envVarName: "VLLM_BASE_URL",
    },
    create: {
      name: "vllm",
      displayName: "vLLM",
      description: "Local OpenAI-compatible inference (cmps01)",
      requiresApiKey: false,
      defaultBaseUrl: "http://localhost:8001/v1",
      envVarName: "VLLM_BASE_URL",
      isActive: true,
    },
  });

  const openaiModels = [
    { modelId: "gpt-4.1", name: "GPT-4.1", description: "Advanced GPT-4.1", maxTokens: 128000, inputPricing: 5, outputPricing: 15 },
    { modelId: "gpt-4o", name: "GPT-4o", description: "Multimodal flagship", maxTokens: 128000, inputPricing: 2.5, outputPricing: 10 },
    { modelId: "gpt-4o-mini", name: "GPT-4o Mini", description: "Fast and cheap", maxTokens: 128000, inputPricing: 0.15, outputPricing: 0.6 },
  ];

  for (const m of openaiModels) {
    await prisma.aIModel.upsert({
      where: { providerId_modelId: { providerId: openai.id, modelId: m.modelId } },
      update: { isActive: true },
      create: { ...m, type: "CHAT", supportsImages: true, supportsTools: true, supportsStreaming: true, providerId: openai.id },
    });
  }

  const googleModels = [
    { modelId: "gemini-2.5-pro", name: "Gemini 2.5 Pro", description: "Advanced multimodal", maxTokens: 2097152, inputPricing: 1.25, outputPricing: 5 },
    { modelId: "gemini-2.5-flash", name: "Gemini 2.5 Flash", description: "Fast multimodal", maxTokens: 1048576, inputPricing: 0.075, outputPricing: 0.3 },
  ];

  for (const m of googleModels) {
    await prisma.aIModel.upsert({
      where: { providerId_modelId: { providerId: google.id, modelId: m.modelId } },
      update: { isActive: true },
      create: { ...m, type: "CHAT", supportsImages: true, supportsTools: true, supportsStreaming: true, providerId: google.id },
    });
  }

  const vllmModels = [
    {
      modelId: "qwen2.5-7b-instruct",
      name: "Qwen 2.5 7B (vLLM)",
      description: "House chat — tier 1, hybrid RAG",
      maxTokens: 8192,
      supportsTools: false,
    },
    {
      modelId: "qwen2.5-32b-instruct",
      name: "Qwen 2.5 32B AWQ (vLLM)",
      description: "Large tier — tools via Hermes parser",
      maxTokens: 8192,
      supportsTools: true,
    },
  ];

  for (const m of vllmModels) {
    await prisma.aIModel.upsert({
      where: { providerId_modelId: { providerId: vllm.id, modelId: m.modelId } },
      update: { isActive: true, supportsTools: m.supportsTools },
      create: {
        ...m,
        type: "CHAT",
        supportsImages: false,
        supportsStreaming: true,
        providerId: vllm.id,
      },
    });
  }

  await applyRoutingTierAssignments();
  console.log("[sync-ai-providers] Done (vLLM provider + models synced)");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("[sync-ai-providers] Failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
