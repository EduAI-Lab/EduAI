import type { FleetServer, JobType, WorkloadFeature } from "./types";
import { jobTypeFromFeature } from "./types";

const DEFAULT_CHAT_MODELS = ["qwen2.5-7b-instruct", "qwen2.5-32b-instruct"];

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

let cachedInteractiveServers: FleetServer[] | null = null;
let cachedBackgroundServers: FleetServer[] | null = null;
let cachedDefaultModels: string[] | null = null;

function defaultModels(): string[] {
  if (!cachedDefaultModels) {
    cachedDefaultModels = parseCommaModels(process.env.VLLM_FLEET_DEFAULT_MODELS);
  }
  return cachedDefaultModels;
}

function interactiveServers(): FleetServer[] {
  if (!cachedInteractiveServers) {
    const models = defaultModels();
    cachedInteractiveServers = parseCommaUrls(process.env.VLLM_FLEET_CHAT_URLS).map((url) =>
      buildServer(url, ["interactive"], models),
    );
  }
  return cachedInteractiveServers;
}

function backgroundServers(): FleetServer[] {
  if (!cachedBackgroundServers) {
    const heavyUrl = process.env.VLLM_FLEET_HEAVY_URL?.trim();
    if (!heavyUrl) {
      cachedBackgroundServers = [];
    } else {
      const models = defaultModels();
      cachedBackgroundServers = [buildServer(heavyUrl, ["background"], models)];
    }
  }
  return cachedBackgroundServers;
}

/** Clear cached env-derived registry (unit tests). */
export function resetFleetRegistryCache(): void {
  cachedInteractiveServers = null;
  cachedBackgroundServers = null;
  cachedDefaultModels = null;
}

export function fleetRoutingEnabled(): boolean {
  return interactiveServers().length > 0;
}

export function heavyFleetConfigured(): boolean {
  return backgroundServers().length > 0;
}

export function getServersForJobType(jobType: JobType): FleetServer[] {
  if (jobType === "background") {
    const heavy = backgroundServers();
    if (heavy.length > 0) return heavy;
  }
  return interactiveServers();
}

export function getServersForFeature(feature: WorkloadFeature): FleetServer[] {
  return getServersForJobType(jobTypeFromFeature(feature));
}
