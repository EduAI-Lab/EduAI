#!/usr/bin/env node
/**
 * Per-route initial-JS report for the Core client bundle (issue #1039).
 *
 * Reads build/client/.vite/manifest.json (requires `build.manifest: true`,
 * set in vite.config.ts) and, for every route entry, sums the gzip-relevant
 * raw bytes of its entry chunk plus every statically-imported chunk
 * (transitively). Dynamic imports are excluded — they don't block first load.
 *
 * Usage:
 *   npm run build && node scripts/bundle-report.mjs [--json] [buildDir]
 *
 * `buildDir` defaults to build/client. Pass --json for machine-readable
 * output (used for before/after diffing).
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const buildDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  args.find((a) => !a.startsWith("--")) ?? "build/client",
);

const manifest = JSON.parse(
  readFileSync(path.join(buildDir, ".vite/manifest.json"), "utf8"),
);

const sizeOf = (file) => {
  try {
    return statSync(path.join(buildDir, file)).size;
  } catch {
    return 0;
  }
};

/** Collect entry chunk + transitive static imports for a manifest key. */
function initialChunks(key, seen = new Set()) {
  if (seen.has(key)) return seen;
  const entry = manifest[key];
  if (!entry) return seen;
  seen.add(key);
  for (const imp of entry.imports ?? []) initialChunks(imp, seen);
  return seen;
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

// A page's initial JS is the union of three graphs the browser loads up
// front: the client entry, the root route, and the matched route. Summing a
// route's graph alone under-counts (framework code hides under entry.client)
// and shifts when manualChunks moves modules between graphs.
const entries = Object.entries(manifest).filter(([, v]) => v.isEntry);
const findKey = (needle) =>
  entries.find(([k]) => k.includes(needle))?.[0] ?? null;
const baseKeys = [findKey("entry.client"), findKey("root")].filter(Boolean);

const rows = entries
  .map(([key, v]) => {
    const seen = new Set();
    for (const base of baseKeys) initialChunks(base, seen);
    initialChunks(key, seen);
    const files = [...seen].map((k) => manifest[k].file);
    const bytes = files.reduce((sum, f) => sum + sizeOf(f), 0);
    return { route: v.name ?? key, key, chunks: files.length, bytes };
  })
  .sort((a, b) => b.bytes - a.bytes);

if (asJson) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const pad = Math.max(...rows.map((r) => r.route.length), 5);
  console.log(`${"route".padEnd(pad)}  chunks  initial JS`);
  for (const r of rows) {
    console.log(
      `${r.route.padEnd(pad)}  ${String(r.chunks).padStart(6)}  ${kb(r.bytes)}`,
    );
  }
  const root = rows.find((r) => r.key.includes("root")) ?? rows[0];
  console.log(
    `\n${rows.length} route entries; root baseline: ${kb(root.bytes)}; largest: ${kb(rows[0].bytes)}`,
  );
}
