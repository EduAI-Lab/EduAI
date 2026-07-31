#!/usr/bin/env node
/**
 * Design-token parity oracle (#1272).
 *
 * Captures the *resolved* custom-property map for each app and diffs it against
 * a baseline. The consolidation work in #1272/#1301 is value-preserving by
 * construction, so any unexplained diff is a bug.
 *
 *   node scripts/token-parity.mjs capture <out.json>
 *   node scripts/token-parity.mjs check   <baseline.json> [--allow --tok-a,--tok-b]
 *
 * Why it is not just "diff the stylesheet":
 *  - After extraction an app's tokens come from the shared file *and* its own,
 *    so the cascade has to be replayed across the `@import` chain in order.
 *  - The ramp (#1301) turns literal values into `var()` references. Without
 *    resolving those chains every repointed token reads as changed.
 *  - ai-tutor's stylesheet was prettier-formatted at some point, so it writes
 *    `oklch(1 0 0)` where the others write `oklch(1.0000 0 0)`. Without numeric
 *    normalisation every one of its tokens is a false positive.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const REPO = path.resolve(import.meta.dirname, "..");

/** Entry stylesheet per app. `@import`s are followed from here, in order. */
const APPS = {
  core: "apps/core/app/app.css",
  "ai-tutor": "apps/extensions/ai-tutor/app/app.css",
  "question-maker": "apps/extensions/question-maker/app/frontend/src/index.css",
};

/**
 * Strip `/* *\/` comments, but never inside a quoted string. Naive regex
 * stripping is wrong here: `@source "../node_modules/streamdown/dist/*.js"`
 * contains `/*`, which opens a comment that swallows everything up to the next
 * `*\/` — in Core's stylesheet that silently ate `@theme` and `:root` whole.
 */
function stripComments(css) {
  let out = "";
  for (let i = 0; i < css.length; ) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out += ch;
      i++;
      while (i < css.length) {
        if (css[i] === "\\") {
          out += css.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += css[i];
        i++;
        if (css[i - 1] === quote) break;
      }
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      i += 2;
      while (i < css.length && !(css[i] === "*" && css[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Collect stylesheet sources in cascade order, following relative `@import`s.
 * Bare specifiers (tailwindcss, katex/...) are package imports we do not own.
 */
function collectSources(entry, seen = new Set()) {
  const abs = path.resolve(REPO, entry);
  if (seen.has(abs) || !fs.existsSync(abs)) return [];
  seen.add(abs);

  const css = stripComments(fs.readFileSync(abs, "utf8"));
  const out = [];
  const importRe = /@import\s+["']([^"']+)["']\s*;/g;
  let m;
  let lastIndex = 0;

  while ((m = importRe.exec(css)) !== null) {
    const spec = m[1];
    if (spec.startsWith(".") || spec.startsWith("/")) {
      // Emit anything declared before this import, then recurse.
      out.push(css.slice(lastIndex, m.index));
      out.push(...collectSources(path.relative(REPO, path.resolve(path.dirname(abs), spec)), seen));
      lastIndex = importRe.lastIndex;
    }
  }
  out.push(css.slice(lastIndex));
  return out;
}

/** Extract the body of every top-level block whose selector matches `re`. */
function blocks(css, re) {
  const found = [];
  let m;
  const scan = new RegExp(re.source, "g");
  while ((m = scan.exec(css)) !== null) {
    const open = css.indexOf("{", m.index);
    if (open === -1) continue;
    let depth = 0;
    let i = open;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    found.push(css.slice(open + 1, i));
    scan.lastIndex = i;
  }
  return found;
}

/** Top-level `--x: value;` declarations only — nested rules are skipped. */
function decls(body) {
  const out = new Map();
  let depth = 0;
  let buf = "";
  for (const ch of body) {
    if (ch === "{") {
      depth++;
      buf += ch;
    } else if (ch === "}") {
      depth--;
      buf += ch;
      if (depth === 0) buf = "";
    } else if (ch === ";" && depth === 0) {
      const d = buf.trim();
      const i = d.indexOf(":");
      if (d.startsWith("--") && i > 0) out.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  return out;
}

/**
 * Normalise so cosmetic rewrites do not read as value changes:
 * trailing zeros, quote style, whitespace. Hex literals are left intact.
 */
function normalise(value) {
  return String(value ?? "")
    .replace(/'/g, '"')
    .replace(/(?<![\w#.-])(\d*\.?\d+)(?![\w])/g, (n) => String(parseFloat(n)))
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

/** Build the light and dark token maps for one app, cascade order preserved. */
function tokensFor(entry) {
  const sources = collectSources(entry);
  const layers = { base: new Map(), root: new Map(), dark: new Map() };

  for (const css of sources) {
    // `@theme` / `@theme inline` first — lowest precedence, they seed defaults.
    for (const body of blocks(css, /@theme(\s+inline)?\s*\{/))
      for (const [k, v] of decls(body)) layers.base.set(k, v);
    for (const body of blocks(css, /(^|\n|\})\s*:root\s*\{/))
      for (const [k, v] of decls(body)) layers.root.set(k, v);
    for (const body of blocks(css, /(^|\n|\})\s*\.dark\s*\{/))
      for (const [k, v] of decls(body)) layers.dark.set(k, v);
  }

  const light = new Map([...layers.base, ...layers.root]);
  const dark = new Map([...layers.base, ...layers.root, ...layers.dark]);

  const resolve = (map, value, depth = 0) => {
    if (depth > 10) return value;
    const m = String(value ?? "").match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)$/);
    if (!m) return value;
    const target = map.get(m[1]);
    if (target === undefined) return m[2] !== undefined ? resolve(map, m[2].trim(), depth + 1) : value;
    return resolve(map, target, depth + 1);
  };

  const materialise = (map) => {
    const out = {};
    for (const key of [...map.keys()].sort()) out[key] = normalise(resolve(map, map.get(key)));
    return out;
  };

  return { light: materialise(light), dark: materialise(dark) };
}

function capture() {
  const snapshot = {};
  for (const [app, entry] of Object.entries(APPS)) snapshot[app] = tokensFor(entry);
  return snapshot;
}

function diff(baseline, current, allow) {
  const problems = [];
  for (const app of new Set([...Object.keys(baseline), ...Object.keys(current)])) {
    for (const mode of ["light", "dark"]) {
      const a = baseline[app]?.[mode] ?? {};
      const b = current[app]?.[mode] ?? {};
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (allow.has(key)) continue;
        if (a[key] === b[key]) continue;
        const label = `${app}/${mode} ${key}`;
        if (!(key in b)) problems.push(`REMOVED  ${label}  was ${a[key]}`);
        else if (!(key in a)) problems.push(`ADDED    ${label}  now ${b[key]}`);
        else problems.push(`CHANGED  ${label}\n           before ${a[key]}\n           after  ${b[key]}`);
      }
    }
  }
  return problems;
}

export { stripComments, blocks, decls, normalise, tokensFor, capture, diff };

function main() {
  const [cmd, file, ...rest] = process.argv.slice(2);

  if (cmd === "capture") {
    if (!file) throw new Error("usage: token-parity.mjs capture <out.json>");
    const snap = capture();
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(snap, null, 2) + "\n");
    for (const [app, modes] of Object.entries(snap))
      console.log(`  ${app.padEnd(16)} ${Object.keys(modes.light).length} light / ${Object.keys(modes.dark).length} dark`);
    console.log(`baseline written to ${file}`);
    return;
  }

  if (cmd === "check") {
    if (!file) throw new Error("usage: token-parity.mjs check <baseline.json> [--allow --a,--b]");
    const idx = rest.indexOf("--allow");
    const allow = new Set(idx === -1 ? [] : (rest[idx + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean));
    const problems = diff(JSON.parse(fs.readFileSync(file, "utf8")), capture(), allow);
    if (allow.size) console.log(`allowing expected deltas: ${[...allow].join(", ")}`);
    if (problems.length) {
      console.error(`\n\u2717 token parity FAILED \u2014 ${problems.length} unexpected difference(s):\n`);
      for (const p of problems) console.error("  " + p);
      process.exit(1);
    }
    console.log("\u2713 token parity holds \u2014 every resolved value is unchanged");
    return;
  }

  console.error("usage: token-parity.mjs capture <out.json> | check <baseline.json> [--allow --a,--b]");
  process.exit(2);
}

// Importable for tests; the CLI runs only when this file is executed directly.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
