#!/usr/bin/env node
/**
 * Smoke test every host in VLLM_FLEET_CHAT_URLS (+ optional VLLM_FLEET_HEAVY_URL).
 *
 * Reads apps/core/.env. Or pass inline:
 *   VLLM_FLEET_CHAT_URLS=http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001 npm run fleet:smoke
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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

function parseCommaList(raw) {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function serverIdFromUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host.split(".")[0] || host;
  } catch {
    return url;
  }
}

loadEnvFile();

const apiKey = process.env.VLLM_API_KEY || "vllm-local";
const timeoutMs = Number(process.env.VLLM_FLEET_SMOKE_TIMEOUT_MS || "8000");
const expectedModels = parseCommaList(
  process.env.VLLM_FLEET_DEFAULT_MODELS || "qwen2.5-7b-instruct,qwen2.5-32b-instruct",
);

const chatUrls = parseCommaList(process.env.VLLM_FLEET_CHAT_URLS);
const heavyUrl = process.env.VLLM_FLEET_HEAVY_URL?.trim();

/** @type {{ url: string; pool: string }[]} */
const targets = chatUrls.map((url) => ({ url: url.replace(/\/$/, ""), pool: "interactive" }));
if (heavyUrl && !chatUrls.some((u) => u.replace(/\/$/, "") === heavyUrl.replace(/\/$/, ""))) {
  targets.push({ url: heavyUrl.replace(/\/$/, ""), pool: "background" });
}

async function checkHost({ url, pool }) {
  const id = serverIdFromUrl(url);
  const label = `${id} (${pool})`;
  const t0 = performance.now();
  try {
    const res = await fetch(`${url}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const elapsed = Math.round(performance.now() - t0);
    if (!res.ok) {
      const text = await res.text();
      console.log(`FAIL  ${label}  HTTP ${res.status} (${elapsed} ms)`);
      console.log(`      ${text.slice(0, 300)}`);
      return { ok: false, id, pool, modelIds: [] };
    }
    const body = await res.json();
    const modelIds = Array.isArray(body.data)
      ? body.data.map((m) => m?.id).filter(Boolean)
      : [];
    const missing = expectedModels.filter(
      (m) => !modelIds.some((id) => id.toLowerCase() === m.toLowerCase()),
    );
    console.log(`OK    ${label}  ${elapsed} ms  models: ${modelIds.join(", ") || "(none)"}`);
    if (missing.length > 0) {
      console.log(`WARN  ${label}  missing expected models: ${missing.join(", ")}`);
    }
    return { ok: true, id, pool, modelIds, missing };
  } catch (err) {
    const elapsed = Math.round(performance.now() - t0);
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`FAIL  ${label}  ${msg} (${elapsed} ms)`);
    return { ok: false, id, pool, modelIds: [] };
  }
}

async function main() {
  if (targets.length === 0) {
    console.error(
      "VLLM_FLEET_CHAT_URLS not set. Add to apps/core/.env:\n" +
        '  VLLM_FLEET_CHAT_URLS="http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001"\n' +
        '  VLLM_API_KEY="vllm-local"\n' +
        '  VLLM_FLEET_DEFAULT_MODELS="qwen2.5-7b-instruct,qwen2.5-32b-instruct"',
    );
    process.exit(1);
  }

  console.log(`Fleet smoke — ${targets.length} host(s), expected models: ${expectedModels.join(", ")}\n`);

  const results = [];
  for (const target of targets) {
    results.push(await checkHost(target));
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(`\nSummary: ${okCount}/${results.length} hosts healthy`);
  if (okCount >= 2) {
    console.log("Round-robin: send several chat requests and check X-Fleet-Server alternates.");
  }

  if (okCount === 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
