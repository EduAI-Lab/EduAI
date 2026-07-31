import {
  jobTypeForWorkloadFeature,
  type FleetServer,
  type JobType,
  type WorkloadFeature,
} from "./types";

const DEFAULT_CHAT_MODELS = ["qwen3.5-2b", "qwen3.5-27b"];

function parseCommaUrls(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseCommaModels(raw: string | undefined): string[] {
  if (!raw?.trim()) return DEFAULT_CHAT_MODELS;
  const models = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return models.length > 0 ? models : DEFAULT_CHAT_MODELS;
}

export function serverIdFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    const segment = host.split(".")[0];
    return segment || host;
  } catch {
    return url;
  }
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function buildServer(url: string, jobTypes: JobType[], models: string[]): FleetServer {
  const baseUrl = normalizeBaseUrl(url);
  return {
    id: serverIdFromUrl(baseUrl),
    baseUrl,
    jobTypes,
    models,
    energySidecarUrl: `${baseUrl}/energy`,
  };
}

let cachedChatServers: FleetServer[] | null = null;
let cachedHeavyServers: FleetServer[] | null = null;
let cachedDefaultModels: string[] | null = null;

function defaultModels(): string[] {
  if (!cachedDefaultModels) {
    cachedDefaultModels = parseCommaModels(process.env.VLLM_FLEET_DEFAULT_MODELS);
  }
  return cachedDefaultModels;
}

function chatServers(): FleetServer[] {
  if (!cachedChatServers) {
    const models = defaultModels();
    cachedChatServers = parseCommaUrls(process.env.VLLM_FLEET_CHAT_URLS).map((url) =>
      buildServer(url, ["interactive"], models),
    );
  }
  return cachedChatServers;
}

function heavyServers(): FleetServer[] {
  if (!cachedHeavyServers) {
    const heavyUrl = process.env.VLLM_FLEET_HEAVY_URL?.trim();
    if (!heavyUrl) {
      cachedHeavyServers = [];
    } else {
      const models = defaultModels();
      cachedHeavyServers = [buildServer(heavyUrl, ["background"], models)];
    }
  }
  return cachedHeavyServers;
}

/** Clear cached env-derived registry (unit tests). */
export function resetFleetRegistryCache(): void {
  cachedChatServers = null;
  cachedHeavyServers = null;
  cachedDefaultModels = null;
}

export function fleetRoutingEnabled(): boolean {
  return chatServers().length > 0;
}

export function heavyFleetConfigured(): boolean {
  return heavyServers().length > 0;
}

export function getServersForJobType(jobType: JobType): FleetServer[] {
  if (jobType === "background") {
    const heavy = heavyServers();
    if (heavy.length > 0) return heavy;
  }
  return chatServers();
}

/** Compatibility adapter for PR4 callers that still identify workloads by feature. */
export function getServersForFeature(feature: WorkloadFeature): FleetServer[] {
  return getServersForJobType(jobTypeForWorkloadFeature(feature));
}
