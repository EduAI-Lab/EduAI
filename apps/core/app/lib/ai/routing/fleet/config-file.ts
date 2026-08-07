/**
 * Fleet config file loader (#1351 follow-up).
 *
 * Registering a fleet server used to mean editing a packed comma-separated
 * URL string (VLLM_FLEET_CHAT_URLS) that couldn't express per-server model
 * lists — every server in a pool shared one VLLM_FLEET_DEFAULT_MODELS list,
 * so the admin "Servers" tab couldn't show which models a given box actually
 * hosts. A structured file fixes both: it's diffable in a PR, and each server
 * entry carries its own `models`.
 *
 * File shape matches `FleetServer` directly — no shape translation needed:
 *   { "servers": [ { "id", "baseUrl", "jobTypes", "models"? }, ... ] }
 *
 * `models` is optional. The models a server actually hosts are read live
 * from its /v1/models endpoint (see health.ts's getServerHealth, already
 * called on every routing decision and cached 30s) — that's the real source
 * of truth, and it stays correct as models get swapped on a box without
 * anyone remembering to update this file. `models` here is only a fallback
 * used by serverHostsModel() if the live probe fails.
 *
 * Env vars (VLLM_FLEET_CHAT_URLS / VLLM_FLEET_HEAVY_URL /
 * VLLM_FLEET_DEFAULT_MODELS) remain a fallback when no config file is
 * present, so existing deployments keep working unmodified until they
 * migrate. See registry.ts for the fallback wiring.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FleetServer, JobType } from "./types";

const DEFAULT_CONFIG_PATH = "./fleet.config.json";
const VALID_JOB_TYPES: JobType[] = ["interactive", "background"];

export class FleetConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FleetConfigError";
  }
}

function configPath(): string {
  return process.env.FLEET_CONFIG_PATH?.trim() || DEFAULT_CONFIG_PATH;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

/** Validates one raw JSON server entry into a `FleetServer`, or throws with a pointer to the bad field. */
function parseServerEntry(raw: unknown, index: number): FleetServer {
  if (!raw || typeof raw !== "object") {
    throw new FleetConfigError(`fleet config servers[${index}] must be an object`);
  }
  const entry = raw as Record<string, unknown>;

  if (typeof entry.id !== "string" || !entry.id.trim()) {
    throw new FleetConfigError(`fleet config servers[${index}].id must be a non-empty string`);
  }
  if (typeof entry.baseUrl !== "string" || !entry.baseUrl.trim()) {
    throw new FleetConfigError(`fleet config servers[${index}].baseUrl must be a non-empty string`);
  }
  try {
    // eslint-disable-next-line no-new -- validation only, discard the URL instance
    new URL(entry.baseUrl);
  } catch {
    throw new FleetConfigError(
      `fleet config servers[${index}].baseUrl is not a valid URL: ${entry.baseUrl}`,
    );
  }

  const jobTypesRaw = entry.jobTypes;
  if (
    !Array.isArray(jobTypesRaw) ||
    jobTypesRaw.length === 0 ||
    !jobTypesRaw.every((j) => typeof j === "string" && VALID_JOB_TYPES.includes(j as JobType))
  ) {
    throw new FleetConfigError(
      `fleet config servers[${index}].jobTypes must be a non-empty array of "interactive" | "background"`,
    );
  }

  // `models` is optional and only used as a fallback (see serverHostsModel in
  // health.ts) when a live /v1/models probe fails — the servers this project
  // runs swap models often enough that a static list would just go stale.
  // Omit it entirely and the fleet still works; the admin UI shows whatever
  // the live health probe reports.
  const modelsRaw = entry.models;
  let models: string[] = [];
  if (modelsRaw !== undefined) {
    if (!Array.isArray(modelsRaw) || !modelsRaw.every((m) => typeof m === "string" && m.trim())) {
      throw new FleetConfigError(
        `fleet config servers[${index}].models, if present, must be an array of strings`,
      );
    }
    models = modelsRaw as string[];
  }

  return {
    id: entry.id.trim(),
    baseUrl: normalizeBaseUrl(entry.baseUrl.trim()),
    jobTypes: jobTypesRaw as JobType[],
    models,
  };
}

export type FleetConfigFile = {
  servers: FleetServer[];
};

/**
 * Reads and validates the fleet config file. Returns null (not an error)
 * when the file does not exist, so callers fall back to env vars — a missing
 * file is the expected steady state until a deployment migrates. Throws
 * FleetConfigError for a present-but-malformed file, since silently ignoring
 * a typo'd config would leave the fleet quietly misrouted.
 */
export function loadFleetConfigFile(): FleetConfigFile | null {
  const path = resolve(configPath());
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw new FleetConfigError(`failed to read fleet config file at ${path}: ${String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new FleetConfigError(`fleet config file at ${path} is not valid JSON: ${String(err)}`);
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { servers?: unknown }).servers)) {
    throw new FleetConfigError(`fleet config file at ${path} must have a top-level "servers" array`);
  }

  const servers = (parsed as { servers: unknown[] }).servers.map((entry, index) =>
    parseServerEntry(entry, index),
  );

  const ids = new Set<string>();
  for (const server of servers) {
    if (ids.has(server.id)) {
      throw new FleetConfigError(`fleet config file at ${path} has a duplicate server id: ${server.id}`);
    }
    ids.add(server.id);
  }

  return { servers };
}
