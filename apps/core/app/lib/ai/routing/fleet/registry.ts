import { loadFleetConfigFile } from "./config-file";
import {
  jobTypeForWorkloadFeature,
  type FleetServer,
  type JobType,
  type WorkloadFeature,
} from "./types";

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
  };
}

let cachedChatServers: FleetServer[] | null = null;
let cachedHeavyServers: FleetServer[] | null = null;
let cachedDefaultModels: string[] | null = null;
let cachedConfigFileServers: FleetServer[] | null | undefined; // undefined = not yet loaded
let loggedEnvFallbackDeprecation = false;

function defaultModels(): string[] {
  if (!cachedDefaultModels) {
    cachedDefaultModels = parseCommaModels(process.env.VLLM_FLEET_DEFAULT_MODELS);
  }
  return cachedDefaultModels;
}

/** Servers declared in fleet.config.json, or null if the file is absent (fall back to env vars). */
function configFileServers(): FleetServer[] | null {
  if (cachedConfigFileServers === undefined) {
    const config = loadFleetConfigFile();
    cachedConfigFileServers = config ? config.servers : null;
  }
  return cachedConfigFileServers;
}

function serversByJobType(jobType: JobType): FleetServer[] {
  const configured = configFileServers();
  if (configured) {
    return configured.filter((server) => server.jobTypes.includes(jobType));
  }

  // Config file absent: fall back to the legacy comma-separated env vars.
  // Logged once so a deployment that hasn't migrated yet is still visible in
  // logs without spamming on every request.
  if (!loggedEnvFallbackDeprecation) {
    loggedEnvFallbackDeprecation = true;
    console.warn(
      "[fleet] No fleet.config.json found (or FLEET_CONFIG_PATH unset) — falling back to " +
        "VLLM_FLEET_CHAT_URLS / VLLM_FLEET_HEAVY_URL / VLLM_FLEET_DEFAULT_MODELS env vars. " +
        "These env vars are deprecated in favor of a config file: see fleet.config.example.json.",
    );
  }

  if (jobType === "background") {
    const heavyUrl = process.env.VLLM_FLEET_HEAVY_URL?.trim();
    if (!heavyUrl) return [];
    return [buildServer(heavyUrl, ["background"], defaultModels())];
  }
  return parseCommaUrls(process.env.VLLM_FLEET_CHAT_URLS).map((url) =>
    buildServer(url, ["interactive"], defaultModels()),
  );
}

function chatServers(): FleetServer[] {
  if (!cachedChatServers) {
    cachedChatServers = serversByJobType("interactive");
  }
  return cachedChatServers;
}

function heavyServers(): FleetServer[] {
  if (!cachedHeavyServers) {
    cachedHeavyServers = serversByJobType("background");
  }
  return cachedHeavyServers;
}

/** Clear cached env/config-derived registry (unit tests). */
export function resetFleetRegistryCache(): void {
  cachedChatServers = null;
  cachedHeavyServers = null;
  cachedDefaultModels = null;
  cachedConfigFileServers = undefined;
  loggedEnvFallbackDeprecation = false;
}

/** All servers known to the fleet, config-file or env-derived, deduplicated by id. Used by the admin stats view. */
export function getAllFleetServers(): FleetServer[] {
  const configured = configFileServers();
  if (configured) return configured;

  const byId = new Map<FleetServer["id"], FleetServer>();
  for (const server of [...chatServers(), ...heavyServers()]) {
    byId.set(server.id, server);
  }
  return [...byId.values()];
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
