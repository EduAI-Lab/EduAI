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

const HOST = process.env.ENERGY_METER_HOST ?? "127.0.0.1";
const PORT = Number(process.env.ENERGY_METER_PORT ?? "9100");
const GRID = Number(process.env.LOCAL_GRID_GCO2_PER_KWH ?? "12");
const SAMPLE_MS = Math.max(50, Number(process.env.ENERGY_SAMPLE_MS ?? "1000") || 1000);
const SESSION_TTL_MS = 5 * 60 * 1000;
const MAX_GPU_INDEX = 7;

/** @param {unknown} raw */
function validateGpuIndices(raw) {
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return values
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= MAX_GPU_INDEX);
}

/** Comma-separated GPU indices, e.g. "0,1". Default: all visible GPUs. */
function resolveGpuIndices() {
  const raw = process.env.ENERGY_GPU_INDICES?.trim();
  if (raw) {
    return raw
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 0);
  }
  const r = spawnSync("nvidia-smi", ["--query-gpu=index", "--format=csv,noheader"], {
    encoding: "utf8",
    timeout: 5000,
  });
  if (r.status !== 0) return [0];
  const indices = String(r.stdout ?? "")
    .split("\n")
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isInteger(n));
  return indices.length ? indices : [0];
}

/** @type {Map<string, { raplStart: number|null, gpu: GpuSampler, t0: number }>} */
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
    const r = spawnSync("nvidia-smi", ["--query-gpu=index", "--format=csv,noheader"], {
      encoding: "utf8",
      timeout: 5000,
    });
    return r.status === 0 && String(r.stdout ?? "").trim().length > 0;
  } catch {
    return false;
  }
}

function readRaplUj() {
  try {
    const base = "/sys/class/powercap";
    let total = 0;
    let found = false;
    for (const name of readdirSync(base)) {
      if (!name.startsWith("intel-rapl")) continue;
      try {
        const uj = readFileSync(`${base}/${name}/energy_uj`, "utf8").trim();
        total += Number(uj);
        found = true;
      } catch {
        /* skip zone */
      }
    }
    return found ? total : null;
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
    const samples = this.samples;
    if (samples.length < 2) {
      if (samples.length === 1) return (samples[0].mw / 1000) * (SAMPLE_MS / 1000);
      return null;
    }
    let joules = 0;
    const dt = SAMPLE_MS / 1000;
    for (let i = 1; i < samples.length; i++) {
      joules += ((samples[i - 1].mw + samples[i].mw) / 2 / 1000) * dt;
    }
    return joules;
  }
}

function finishSession(session) {
  const durationMs = Math.round(performance.now() - session.t0);
  const raplEnd = readRaplUj();
  const joulesGpu = session.gpu?.stop() ?? null;

  let joulesCpu = null;
  if (session.raplStart != null && raplEnd != null) {
    joulesCpu = Math.max(0, raplEnd - session.raplStart) / 1_000_000;
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
    const raplAvailable = readRaplUj() != null;
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
    if (!gpuIndices.length) {
      sendJson(res, 400, { error: "invalid or missing gpuIndex/gpuIndices" });
      return;
    }
    const gpu = new GpuSampler(gpuIndices);
    gpu.start();
    sessions.set(tag, {
      raplStart: readRaplUj(),
      gpu,
      t0: performance.now(),
    });
    sendJson(res, 200, { ok: true, tag });
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
