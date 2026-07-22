#!/usr/bin/env node
/**
 * perf-quality.mjs — Issue #961 code-quality baseline (no running stack, no auth).
 *
 * Runs jscpd (duplication), madge (circular deps + graphs), ts-prune (dead TS exports),
 * and knip (dead code/deps) across all three apps, writing reports under PERF_OUT.
 *
 * Usage:
 *   PERF_OUT=docs/perf/baseline-2026-07-09 node scripts/perf-quality.mjs
 *
 * Tools are root devDependencies (jscpd, ts-prune, madge) + knip (in ai-tutor, hoisted).
 * Note: Core/QM have no tuned knip config yet — those runs are unconfigured baselines
 * (noisy; flag scripts/route-modules as "unused"). ai-tutor knip uses its knip.json.
 */
import { execSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";

const OUT = process.env.PERF_OUT ?? `docs/perf/baseline-${new Date().toISOString().slice(0, 10)}`;
const BIN = "node_modules/.bin";
for (const d of [`${OUT}/duplication`, `${OUT}/dead-code`, `${OUT}/dep-graph`]) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}
// Merge stdout+stderr (madge prints its result to stdout, progress to stderr) and strip ANSI.
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const sh = (cmd) => {
  try { return stripAnsi(execSync(cmd + " 2>&1", { stdio: ["ignore", "pipe", "ignore"] }).toString()); }
  catch (e) { return stripAnsi((e.stdout?.toString() ?? "")); }
};
// stdout only (progress goes to stderr) — for capturing clean JSON.
const shOut = (cmd) => {
  try { return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).toString(); }
  catch (e) { return (e.stdout?.toString() ?? ""); }
};
const write = (p, s) => writeFileSync(p, s);

const SRC = {
  core: { ext: "ts,tsx", path: "apps/core/app" },
  "aitutor-server": { ext: "js", path: "apps/extensions/ai-tutor/server/src" },
  "aitutor-frontend": { ext: "ts,tsx", path: "apps/extensions/ai-tutor/app" },
  "qm-backend": { ext: "js", path: "apps/extensions/question-maker/app/backend/src" },
  "qm-frontend": { ext: "ts,tsx", path: "apps/extensions/question-maker/app/frontend/src" },
};
const TS_PROJECTS = {
  core: "apps/core/tsconfig.json",
  "aitutor-frontend": "apps/extensions/ai-tutor/tsconfig.json",
  "qm-frontend": "apps/extensions/question-maker/app/frontend/tsconfig.json",
};

console.error("== jscpd (duplication) ==");
// --output overrides the hard-coded path in .jscpd.json so before/after runs honor PERF_OUT
// and don't clobber each other.
console.error(sh(`${BIN}/jscpd --output ${OUT}/duplication ${Object.values(SRC).map((s) => s.path).join(" ")}`));

console.error("== madge (circular + graphs) ==");
let circular = `madge circular-dependency check — ${new Date().toISOString()}\nTool: madge 8.0.0.  Command per app: madge --circular --extensions <ext> <path>\n`;
let cycleCount = 0;
for (const [name, { ext, path }] of Object.entries(SRC)) {
  const out = sh(`${BIN}/madge --circular --extensions ${ext} ${path}`);
  if (!/No circular dependency found/.test(out)) cycleCount++;
  circular += `\n=== ${name} (${path}) ===\n${out.trim()}\n`;
  writeFileSync(`${OUT}/dep-graph/graph-${name}.json`, shOut(`${BIN}/madge --json --extensions ${ext} ${path}`));
}
circular += `\n------------------------------------------------------------\nRESULT: ${cycleCount === 0 ? "0 circular dependencies across all 5 module graphs." : cycleCount + " graph(s) with cycles — see above."}\nOrphan/graph JSON: graph-*.json. Orphan lists are noisy for entry-point-heavy trees\n(RR route modules / Express route files load via config, not static import) — use\nts-prune + knip (dead-code/) for real unused-export signal, not orphans.\n`;
write(`${OUT}/dep-graph/circular.txt`, circular);

console.error("== ts-prune (dead TS exports) ==");
for (const [name, tsconfig] of Object.entries(TS_PROJECTS)) {
  sh(`${BIN}/ts-prune -p ${tsconfig} > ${OUT}/dead-code/ts-prune-${name}.txt`);
}

console.error("== knip (dead code/deps) ==");
sh(`cd apps/extensions/ai-tutor && ../../../${BIN}/knip --no-progress --no-exit-code > ../../../${OUT}/dead-code/knip-aitutor.txt 2>&1`);
sh(`cd apps/core && ../../${BIN}/knip --no-progress --no-exit-code > ../../${OUT}/dead-code/knip-core-unconfigured.txt 2>&1`);
sh(`cd apps/extensions/question-maker/app/backend && ../../../../../${BIN}/knip --no-progress --no-exit-code > ../../../../../${OUT}/dead-code/knip-qm-backend-unconfigured.txt 2>&1`);
sh(`cd apps/extensions/question-maker/app/frontend && ../../../../../${BIN}/knip --no-progress --no-exit-code > ../../../../../${OUT}/dead-code/knip-qm-frontend-unconfigured.txt 2>&1`);

console.error(`\n✓ code-quality reports written under ${OUT}/`);
