/**
 * Idempotent upsert of AI providers, models, and routing tier assignments.
 * Safe to run on every dev start (existing DB with users).
 */
import { PrismaClient } from "@prisma/client";
import {
  CAMPUS_INTERACTIVE_MODEL_IDS,
  LEGACY_CAMPUS_MODEL_IDS,
  RETAINED_ASSIST_MODEL_ID,
} from "../app/lib/ai/campus-model-catalog";

const prisma = new PrismaClient();

const ROUTING_TIER_ASSIGNMENTS = [
  {
    providerName: "vllm",
    modelId: CAMPUS_INTERACTIVE_MODEL_IDS[0],
    routerTier: "TIER_1" as const,
    estEnergyJoulesPerToken: 0.04,
    averageCarbonGramsPerToken: 8.9e-7,
  },
  {
    providerName: "vllm",
    modelId: CAMPUS_INTERACTIVE_MODEL_IDS[1],
    routerTier: "TIER_2" as const,
    estEnergyJoulesPerToken: 0.2,
    averageCarbonGramsPerToken: 4.45e-6,
  },
  {
    providerName: "vllm",
    modelId: RETAINED_ASSIST_MODEL_ID,
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

  const google = await prisma.aIProvider.findUnique({
    where: { name: "google" },
  });
  if (google) {
    await prisma.aIModel.updateMany({
      where: { providerId: google.id, routerTier: { not: null } },
      data: { routerTier: null },
    });
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

  const opencode = await prisma.aIProvider.upsert({
    where: { name: "opencode" },
    update: {
      displayName: "OpenCode Go",
      description: "OpenCode Go subscription models, including DeepSeek V4 Flash",
      requiresApiKey: true,
      defaultBaseUrl: "https://opencode.ai/zen/go/v1",
      isActive: true,
    },
    create: {
      name: "opencode",
      displayName: "OpenCode Go",
      description: "OpenCode Go subscription models, including DeepSeek V4 Flash",
      requiresApiKey: true,
      defaultBaseUrl: "https://opencode.ai/zen/go/v1",
      isActive: true,
    },
  });

  const openaiModels = [
    {
      modelId: "gpt-4.1",
      name: "GPT-4.1",
      description: "Advanced GPT-4.1",
      maxTokens: 128000,
      inputPricing: 5,
      outputPricing: 15,
    },
    {
      modelId: "gpt-4o",
      name: "GPT-4o",
      description: "Multimodal flagship",
      maxTokens: 128000,
      inputPricing: 2.5,
      outputPricing: 10,
    },
    {
      modelId: "gpt-4o-mini",
      name: "GPT-4o Mini",
      description: "Fast and cheap",
      maxTokens: 128000,
      inputPricing: 0.15,
      outputPricing: 0.6,
    },
  ];

  for (const m of openaiModels) {
    await prisma.aIModel.upsert({
      where: {
        providerId_modelId: { providerId: openai.id, modelId: m.modelId },
      },
      update: { isActive: true },
      create: {
        ...m,
        type: "CHAT",
        supportsImages: true,
        supportsTools: true,
        supportsStreaming: true,
        providerId: openai.id,
      },
    });
  }

  const googleModels = [
    {
      modelId: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      description: "Advanced multimodal",
      maxTokens: 2097152,
      inputPricing: 1.25,
      outputPricing: 5,
    },
    {
      modelId: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      description: "Fast multimodal",
      maxTokens: 1048576,
      inputPricing: 0.075,
      outputPricing: 0.3,
    },
  ];

  for (const m of googleModels) {
    await prisma.aIModel.upsert({
      where: {
        providerId_modelId: { providerId: google.id, modelId: m.modelId },
      },
      update: { isActive: true },
      create: {
        ...m,
        type: "CHAT",
        supportsImages: true,
        supportsTools: true,
        supportsStreaming: true,
        providerId: google.id,
      },
    });
  }

  const vllmModels = [
    {
      modelId: CAMPUS_INTERACTIVE_MODEL_IDS[0],
      name: "Qwen3.5 2B Instruct (vLLM)",
      description: "House chat — tier 1, hybrid RAG",
      maxTokens: 8192,
      supportsTools: false,
      supportsImages: false,
    },
    {
      modelId: CAMPUS_INTERACTIVE_MODEL_IDS[1],
      name: "Qwen3.5 9B Instruct (vLLM)",
      description: "Standard chat — tier 2, hybrid RAG",
      maxTokens: 8192,
      supportsTools: true,
      supportsImages: false,
    },
    {
      modelId: RETAINED_ASSIST_MODEL_ID,
      name: "Qwen3.8 27B FP8 (vLLM)",
      description: "Large tier — tools and vision via Qwen3 parser",
      maxTokens: 65536,
      supportsTools: true,
      supportsImages: true,
    },
  ];

  for (const m of vllmModels) {
    await prisma.aIModel.upsert({
      where: {
        providerId_modelId: { providerId: vllm.id, modelId: m.modelId },
      },
      update: {
        isActive: true,
        supportsTools: m.supportsTools,
        supportsImages: m.supportsImages,
      },
      create: {
        ...m,
        type: "CHAT",
        supportsImages: m.supportsImages,
        supportsStreaming: true,
        providerId: vllm.id,
      },
    });
  }

  // Keep the retained 32B model active, but remove superseded small-model
  // rows from Auto and the public picker. Qwen3.5 4B was present on the dev
  // host but is not part of the approved 2B/9B fleet target.
  await prisma.aIModel.updateMany({
    where: {
      providerId: vllm.id,
      modelId: { in: [...LEGACY_CAMPUS_MODEL_IDS] },
    },
    data: { isActive: false, routerTier: null },
  });

  await prisma.aIModel.upsert({
    where: { providerId_modelId: { providerId: opencode.id, modelId: "deepseek-v4-flash" } },
    update: {
      name: "DeepSeek V4 Flash (OpenCode Go)",
      description: "OpenCode Go subscription model",
      maxTokens: 32768,
      isActive: true,
      type: "CHAT",
      supportsImages: false,
      supportsTools: false,
      supportsStreaming: true,
    },
    create: {
      modelId: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash (OpenCode Go)",
      description: "OpenCode Go subscription model",
      maxTokens: 32768,
      type: "CHAT",
      supportsImages: false,
      supportsTools: false,
      supportsStreaming: true,
      providerId: opencode.id,
    },
  });

  await applyRoutingTierAssignments();
  console.log("[sync-ai-providers] Done (vLLM + OpenCode providers and models synced)");
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
