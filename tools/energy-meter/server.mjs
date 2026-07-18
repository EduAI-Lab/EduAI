#!/usr/bin/env node
/**
 * Energy meter HTTP sidecar (Node) — same API as server.py.
 * Run on the inference host when possible (needs RAPL sysfs + nvidia-smi).
 *
 *   ENERGY_METER_PORT=9100 node server.mjs
 */
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { integratePowerSamplesMw, raplDeltaJoules } from "./rapl-util.mjs";

const HOST = process.env.ENERGY_METER_HOST ?? "127.0.0.1";
const PORT = Number(process.env.ENERGY_METER_PORT ?? "9100");
const GRID = Number(process.env.LOCAL_GRID_GCO2_PER_KWH ?? "12");
const SAMPLE_MS = Math.max(50, Number(process.env.ENERGY_SAMPLE_MS ?? "1000") || 1000);
const SESSION_TTL_MS = 5 * 60 * 1000;
const MAX_GPU_INDEX = 7;

/** @param {unknown} raw */
function validateGpuIndices(raw) {
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const indices = values.map(Number);
  if (
    indices.length === 0 ||
    indices.some((n) => !Number.isInteger(n) || n < 0 || n > MAX_GPU_INDEX)
  ) {
    return null;
  }
  return [...new Set(indices)];
}

/** Visible GPU indices from nvidia-smi (empty if unavailable). */
function listVisibleGpuIndices() {
  const r = spawnSync("nvidia-smi", ["--query-gpu=index", "--format=csv,noheader"], {
    encoding: "utf8",
    timeout: 5000,
  });
  if (r.status !== 0) return [];
  return String(r.stdout ?? "")
    .split("\n")
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isInteger(n));
}

/**
 * Comma-separated GPU indices, e.g. "0,1". Default: all visible GPUs.
 * Intersects configured indices with GPUs that actually exist so a 1-GPU host
 * with ENERGY_GPU_INDICES=0,1 still samples GPU 0 instead of waiting forever.
 */
function resolveGpuIndices() {
  const visible = listVisibleGpuIndices();
  const raw = process.env.ENERGY_GPU_INDICES?.trim();
  if (raw) {
    const configured = validateGpuIndices(raw.split(",").map((s) => s.trim())) ?? [0];
    if (visible.length) {
      const filtered = configured.filter((i) => visible.includes(i));
      return filtered.length ? filtered : configured.slice(0, 1);
    }
    return configured;
  }
  return visible.length ? visible : [0];
}

/** @type {Map<string, { raplStart: ReturnType<typeof readRaplZones>, gpu: GpuSampler, t0: number }>} */
const sessions = new Map();
/** @type {Record<string, unknown>|null} */
let lastResult = null;

setInterval(() => {
  const now = performance.now();
  for (const [tag, session] of sessions) {
    if (now - session.t0 > SESSION_TTL_MS) {
      session.gpu.stop();
      sessions.delete(tag);
      console.warn(`reaped stale session: ${tag}`);
    }
  }
}, 30_000).unref();

function probeNvmlAvailable() {
  try {
    return listVisibleGpuIndices().length > 0;
  } catch {
    return false;
  }
}

/**
 * Read top-level package-* RAPL zones with wrap ranges.
 * @returns {{ zone: string, uj: number, maxUj: number|null }[]|null}
 */
function readRaplZones() {
  try {
    const base = "/sys/class/powercap";
    /** @type {{ zone: string, uj: number, maxUj: number|null }[]} */
    const zones = [];
    for (const name of readdirSync(base)) {
      // Only sum zones whose sysfs `name` is package-N.
      // On cmps01: intel-rapl:0/2 are packages; :0:0/:2:0 are dram;
      // intel-rapl:1 is psys (platform). MMIO mirrors (if present) are skipped.
      if (!/^intel-rapl:\d+$/.test(name)) continue;
      try {
        const domain = readFileSync(`${base}/${name}/name`, "utf8").trim();
        if (!domain.startsWith("package-")) continue;
        const uj = Number(readFileSync(`${base}/${name}/energy_uj`, "utf8").trim());
        if (!Number.isFinite(uj)) continue;
        let maxUj = null;
        try {
          const maxRaw = Number(
            readFileSync(`${base}/${name}/max_energy_range_uj`, "utf8").trim(),
          );
          if (Number.isFinite(maxRaw) && maxRaw > 0) maxUj = maxRaw;
        } catch {
          /* optional */
        }
        zones.push({ zone: name, uj, maxUj });
      } catch {
        /* skip zone */
      }
    }
    return zones.length ? zones : null;
  } catch {
    return null;
  }
}

class GpuSampler {
  /** @param {number[]} gpuIndices */
  constructor(gpuIndices) {
    this.gpuIndices = gpuIndices.length ? gpuIndices : [0];
    /** @type {{ t: number, mw: number }[]} */
    this.samples = [];
    this.proc = null;
    this.available = false;
    /** @type {Map<number, number>} */
    this.lastPowerByGpu = new Map();
  }

  start() {
    this.samples = [];
    this.lastPowerByGpu.clear();
    // Poll all GPUs: index + power.draw (W), interval in ms (-lms)
    this.proc = spawn("nvidia-smi", [
      "--query-gpu=index,power.draw",
      "--format=csv,noheader,nounits",
      "-lms",
      String(SAMPLE_MS),
    ]);
    this.available = Boolean(this.proc.stdout);
    if (!this.proc.stdout) return;
    this.proc.stdout.on("data", (buf) => {
      for (const line of String(buf).split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split(",").map((s) => s.trim());
        if (parts.length < 2) continue;
        const idx = Number(parts[0]);
        const w = Number(parts[1]);
        if (!Number.isFinite(w)) continue;
        if (!this.gpuIndices.includes(idx)) continue;
        this.lastPowerByGpu.set(idx, w);
        // Flush when every *configured* index has reported at least once in this
        // round. Indices are already intersected with visible GPUs at start.
        if (this.lastPowerByGpu.size === this.gpuIndices.length) {
          let sumMw = 0;
          for (const v of this.lastPowerByGpu.values()) sumMw += v * 1000;
          this.samples.push({ t: performance.now(), mw: sumMw });
          this.lastPowerByGpu.clear();
        }
      }
    });
    this.proc.on("error", () => {
      this.available = false;
    });
  }

  stop() {
    if (this.proc) {
      this.proc.stdout?.removeAllListeners("data");
      this.proc.kill("SIGTERM");
      this.proc = null;
    }
    return integratePowerSamplesMw(this.samples, SAMPLE_MS / 1000);
  }
}

function finishSession(session) {
  const durationMs = Math.round(performance.now() - session.t0);
  const raplEnd = readRaplZones();
  const joulesGpu = session.gpu?.stop() ?? null;

  let joulesCpu = null;
  if (session.raplStart != null && raplEnd != null) {
    joulesCpu = raplDeltaJoules(session.raplStart, raplEnd);
  }

  const parts = [joulesCpu, joulesGpu].filter((j) => j != null);
  const joulesTotal = parts.length ? parts.reduce((a, b) => a + b, 0) : null;

  let source = null;
  if (joulesCpu != null && joulesGpu != null) source = "RAPL_PLUS_NVML";
  else if (joulesGpu != null) source = "NVML_GPU";
  else if (joulesCpu != null) source = "RAPL_CPU";

  const carbonGramsCO2 =
    joulesTotal != null ? (joulesTotal * GRID) / 3_600_000 : null;

  return {
    durationMs,
    joulesCpu,
    joulesGpu,
    joulesDram: null,
    joulesTotal,
    energyJoules: joulesTotal,
    carbonGramsCO2,
    source,
    raplAvailable: joulesCpu != null,
    nvmlAvailable: joulesGpu != null,
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}`);

  if (req.method === "GET" && url.pathname === "/health") {
    const raplAvailable = readRaplZones() != null;
    const nvmlAvailable = probeNvmlAvailable();
    sendJson(res, 200, {
      ok: true,
      service: "eduai-energy-meter-node",
      port: PORT,
      host: HOST,
      raplAvailable,
      nvmlAvailable,
      canMeasure: raplAvailable || nvmlAvailable,
    });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 404, { error: "not found" });
    return;
  }

  const body = await readBody(req);

  if (url.pathname === "/measure-start") {
    // RAPL + NVML are host-wide counters; concurrent sessions would each attribute
    // the full box energy during overlap. Serialize to one active measurement.
    if (sessions.size > 0) {
      sendJson(res, 409, {
        error: "another measurement session is already active; wait for measure-stop",
      });
      return;
    }
    const tag = String(body.tag ?? randomUUID());
    if (sessions.has(tag)) {
      sendJson(res, 409, { error: `session already active: ${tag}` });
      return;
    }
    const gpuIndices =
      body.gpuIndex != null
        ? validateGpuIndices(body.gpuIndex)
        : body.gpuIndices?.length
          ? validateGpuIndices(body.gpuIndices)
          : resolveGpuIndices();
    if (!gpuIndices?.length) {
      sendJson(res, 400, { error: "invalid or missing gpuIndex/gpuIndices" });
      return;
    }
    // Drop indices that are not present on this host (avoids waiting forever).
    const visible = listVisibleGpuIndices();
    const sampled =
      visible.length > 0
        ? gpuIndices.filter((i) => visible.includes(i))
        : gpuIndices;
    if (!sampled.length) {
      sendJson(res, 400, {
        error: `requested GPUs ${gpuIndices.join(",")} not visible (have ${visible.join(",") || "none"})`,
      });
      return;
    }
    const gpu = new GpuSampler(sampled);
    gpu.start();
    sessions.set(tag, {
      raplStart: readRaplZones(),
      gpu,
      t0: performance.now(),
    });
    sendJson(res, 200, { ok: true, tag, gpuIndices: sampled });
    return;
  }

  if (url.pathname === "/measure-stop") {
    let tag = body.tag ? String(body.tag) : null;
    let session;
    if (tag) {
      session = sessions.get(tag);
      sessions.delete(tag);
    } else if (sessions.size === 1) {
      tag = [...sessions.keys()][0];
      session = sessions.get(tag);
      sessions.delete(tag);
    }
    if (!session) {
      sendJson(res, 404, { error: "no active measurement session" });
      return;
    }
    const result = { tag, ...finishSession(session) };
    lastResult = result;
    sendJson(res, 200, result);
    return;
  }

  if (url.pathname === "/measure") {
    // Legacy manual-debugging compatibility; application telemetry uses tagged sessions.
    if (lastResult) {
      sendJson(res, 200, {
        energyJoules: lastResult.energyJoules,
        carbonGramsCO2: lastResult.carbonGramsCO2,
        source: lastResult.source,
      });
    } else {
      sendJson(res, 200, { energyJoules: null, carbonGramsCO2: null, source: null });
    }
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`eduai-energy-meter (node) http://${HOST}:${PORT}`);
});
