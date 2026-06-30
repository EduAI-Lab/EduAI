#!/usr/bin/env node
/**
 * Preflight: energy sidecar must return non-null Joules (GPU host, not s378 app server).
 *
 * Loads `.env` then `.env.research` from apps/core (same pattern as vllm-smoke.mjs).
 *
 * Usage:
 *   npm run research:verify-energy
 *   ENERGY_SIDECAR_URL=http://cmps01.ok.ubc.ca:8001/energy node verify-energy-sidecar.mjs
 *
 * Exit 0 = ready for measured research runs. Exit 1 = fix before batching.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_ENERGY_SIDECAR_URL,
  energyMeasureStart,
  energyMeasureStop,
  isEnergyMeasurementEnabled,
  sidecarFetchInit,
} from "./energy-sidecar.mjs";

function loadEnvFile(filename) {
  const envPath = resolve(process.cwd(), filename);
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

loadEnvFile(".env");
loadEnvFile(".env.research");

function resolveSidecarUrl() {
  const url = process.env.ENERGY_SIDECAR_URL?.trim();
  return (url || DEFAULT_ENERGY_SIDECAR_URL).replace(/\/$/, "");
}

async function fetchHealth(base) {
  const res = await fetch(
    `${base}/health`,
    sidecarFetchInit({ signal: AbortSignal.timeout(8000) }),
  );
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { ok: res.ok, status: res.status, json, text: text.slice(0, 300) };
}

async function probeMeasure(base) {
  const tag = `preflight-${Date.now()}`;
  await energyMeasureStart(tag);
  await new Promise((r) => setTimeout(r, 1500));
  return energyMeasureStop(tag);
}

async function main() {
  if (!isEnergyMeasurementEnabled()) {
    console.log("RESEARCH_MEASURE_ENERGY=0 — energy check skipped.");
    return;
  }

  const base = resolveSidecarUrl();
  console.log("=== energy sidecar preflight ===");
  console.log("url:", base);

  let health;
  try {
    health = await fetchHealth(base);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("\nFAIL: cannot reach sidecar:", msg);
    console.error("\nFix:");
    console.error("  1. Start sidecar ON cmps01: bash tools/energy-meter/deploy-cmps01.sh");
    console.error("  2. Route /energy via nginx on :8001: bash infra/cmps01/deploy-edge-proxy.sh");
    console.error("  3. Set ENERGY_SIDECAR_URL=http://cmps01.ok.ubc.ca:8001/energy in .env.research");
    process.exit(1);
  }

  if (!health.ok) {
    console.error("\nFAIL: health HTTP", health.status, health.text);
    process.exit(1);
  }

  console.log("health:", JSON.stringify(health.json));

  if (health.json?.nvmlAvailable === false && health.json?.raplAvailable === false) {
    console.error("\nFAIL: sidecar reachable but no RAPL or NVML on this host.");
    console.error("Do NOT run the sidecar on s378 — inference GPUs are on cmps01.");
    process.exit(1);
  }

  let probe;
  try {
    probe = await probeMeasure(base);
  } catch (e) {
    console.error("\nFAIL: measure probe error:", e instanceof Error ? e.message : e);
    process.exit(1);
  }

  console.log("probe:", JSON.stringify(probe));

  if (probe.energyJoules == null && probe.joulesTotal == null) {
    console.error("\nFAIL: measure-stop returned null Joules.");
    console.error("Host lacks sensors OR sidecar is on the wrong machine (s378 has no GPU).");
    process.exit(1);
  }

  const joules = probe.energyJoules ?? probe.joulesTotal;
  console.log(`\nOK: sidecar ready (${joules.toFixed(4)} J in probe, source=${probe.source ?? "?"})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
