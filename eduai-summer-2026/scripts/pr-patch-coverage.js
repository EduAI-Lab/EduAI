#!/usr/bin/env node
/**
 * Per-PR patch coverage — advisory, non-blocking.
 *
 * Answers one question per changed source file: "of the lines this PR ADDED or modified,
 * how many does a test actually execute?" (patch coverage). This is deliberately NOT a
 * whole-file percentage delta: file-% moves for reasons unrelated to the PR (denominator
 * shifts, deletions, moves), so it is a noisy signal. Patch coverage isolates the new code.
 *
 * Inputs it reads:
 *   - Added lines per file: `git diff --unified=0 <BASE>...HEAD` (added new-file line numbers).
 *   - Per-line hit counts: each workspace's `coverage/lcov.info` (DA:<line>,<hits>), produced
 *     by the `lcov` reporter that `test:coverage` now emits. Only workspaces that ran (i.e.
 *     turbo `--affected` selected them) have a fresh lcov.info.
 *
 * A changed source file that is IN a workspace's coverage scope but ABSENT from its lcov.info
 * was never imported by any test (v8 omits untouched files) → treated as 0% patch coverage.
 * That is the case we most want to flag: brand-new untested code.
 *
 * Env:
 *   BASE_REF        git ref to diff against (default: origin/development)
 *   WARN_THRESHOLD  per-file patch-% below which a file is flagged ⚠️ (default: 80)
 *   REPO_ROOT       repo root (default: two levels up from this script)
 *
 * Output: a Markdown report on stdout, led by an HTML marker so a CI step can post it as a
 * single sticky PR comment (update-in-place). Always exits 0 — this must never block a merge.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO_ROOT = process.env.REPO_ROOT
  ? path.resolve(process.env.REPO_ROOT)
  : path.resolve(__dirname, "..", "..");
const BASE_REF = process.env.BASE_REF || "origin/development";
const WARN_THRESHOLD = Number(process.env.WARN_THRESHOLD || "80");
const MARKER = "<!-- pr-patch-coverage -->";

// Each workspace: where its lcov.info lands, and which changed files count as "its source"
// (mirrors the include/exclude in that workspace's vitest coverage config). srcPrefix is
// repo-relative; a file must sit under it, match ext, and not be excluded.
const WORKSPACES = [
  {
    label: "core (edu-ai)",
    covDir: "apps/core/coverage",
    srcPrefix: "apps/core/app/",
    ext: /\.(ts|tsx)$/,
    exclude: (p) =>
      /(^|\/)tests\//.test(p) ||
      /\.test\.(ts|tsx)$/.test(p) ||
      /\.d\.ts$/.test(p) ||
      p === "apps/core/app/root.tsx" ||
      p === "apps/core/app/routes.ts",
  },
  {
    label: "ai-tutor-server",
    covDir: "apps/extensions/ai-tutor/server/coverage",
    srcPrefix: "apps/extensions/ai-tutor/server/src/",
    ext: /\.js$/,
    exclude: (p) => p === "apps/extensions/ai-tutor/server/src/index.js",
  },
  {
    label: "question-maker-backend",
    covDir: "apps/extensions/question-maker/app/backend/coverage",
    srcPrefix: "apps/extensions/question-maker/app/backend/src/",
    ext: /\.js$/,
    exclude: (p) => p === "apps/extensions/question-maker/app/backend/src/index.js",
  },
  {
    label: "@eduai/ui",
    covDir: "packages/ui/coverage",
    srcPrefix: "packages/ui/src/",
    ext: /\.(ts|tsx)$/,
    exclude: (p) => /(^|\/)tests\//.test(p) || /\.test\.(ts|tsx)$/.test(p),
  },
  {
    label: "ai-tutor (client)",
    covDir: "apps/extensions/ai-tutor/coverage",
    srcPrefix: "apps/extensions/ai-tutor/app/",
    ext: /\.(ts|tsx)$/,
    exclude: (p) =>
      /(^|\/)tests\//.test(p) ||
      /\.test\.(ts|tsx)$/.test(p) ||
      p === "apps/extensions/ai-tutor/app/root.tsx" ||
      p === "apps/extensions/ai-tutor/app/routes.ts",
  },
  {
    label: "question-maker-frontend",
    covDir: "apps/extensions/question-maker/app/frontend/coverage",
    srcPrefix: "apps/extensions/question-maker/app/frontend/src/",
    ext: /\.(ts|tsx)$/,
    exclude: (p) =>
      /(^|\/)tests\//.test(p) ||
      /\.test\.(ts|tsx)$/.test(p) ||
      /\.d\.ts$/.test(p) ||
      p === "apps/extensions/question-maker/app/frontend/src/main.tsx",
  },
];

function git(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// Added (new-file) line numbers per repo-relative path, from a -U0 diff. With zero context,
// every '+' line is a genuine addition; the new-file counter advances only on '+' and context.
function addedLinesByFile(baseRef) {
  let diff;
  try {
    diff = git(["diff", "--unified=0", "--no-color", "--diff-filter=d", `${baseRef}...HEAD`]);
  } catch (err) {
    process.stderr.write(`git diff failed against ${baseRef}: ${err.message}\n`);
    return {};
  }
  const added = {};
  let file = null;
  let newLine = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const p = line.slice(4).replace(/^b\//, "").trim();
      file = p === "/dev/null" ? null : p;
      if (file && !added[file]) added[file] = new Set();
      continue;
    }
    if (line.startsWith("@@")) {
      // @@ -a,b +c,d @@  → additions start numbering at c
      const m = /\+(\d+)(?:,\d+)?/.exec(line);
      newLine = m ? parseInt(m[1], 10) : 0;
      continue;
    }
    if (file && line.startsWith("+") && !line.startsWith("+++")) {
      added[file].add(newLine);
      newLine += 1;
      continue;
    }
    // '-' removals and metadata don't advance the new-file counter (no context lines at -U0).
  }
  return added;
}

// path -> Map(lineNumber -> hits) for one lcov.info. SF paths may be absolute or relative;
// normalize to repo-relative so they match the diff's paths.
function parseLcov(covDir) {
  const file = path.join(REPO_ROOT, covDir, "lcov.info");
  if (!fs.existsSync(file)) return null; // workspace did not run this PR
  const byFile = {};
  let current = null;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const lineStr = raw.trim();
    if (lineStr.startsWith("SF:")) {
      let sf = lineStr.slice(3);
      sf = path.isAbsolute(sf) ? path.relative(REPO_ROOT, sf) : path.relative(REPO_ROOT, path.resolve(REPO_ROOT, covDir, sf));
      sf = sf.split(path.sep).join("/");
      current = byFile[sf] || (byFile[sf] = new Map());
    } else if (lineStr.startsWith("DA:") && current) {
      const [ln, hits] = lineStr.slice(3).split(",");
      current.set(parseInt(ln, 10), parseInt(hits, 10));
    } else if (lineStr === "end_of_record") {
      current = null;
    }
  }
  return byFile;
}

function fmtPct(covered, executable) {
  if (executable === 0) return "—";
  return `${((covered / executable) * 100).toFixed(1)}%`;
}

function main() {
  const added = addedLinesByFile(BASE_REF);
  const changedFiles = Object.keys(added);

  const results = []; // { label, file, executable, covered, uncovered:[lines], inScopeButUnrun }
  const ranWorkspaces = [];
  const skippedWorkspaces = [];

  for (const ws of WORKSPACES) {
    const lcov = parseLcov(ws.covDir);
    const wsFiles = changedFiles.filter(
      (f) => f.startsWith(ws.srcPrefix) && ws.ext.test(f) && !ws.exclude(f)
    );
    if (lcov === null) {
      if (wsFiles.length) skippedWorkspaces.push({ label: ws.label, count: wsFiles.length });
      continue; // no coverage data — turbo --affected didn't select it (or it failed)
    }
    ranWorkspaces.push(ws.label);
    for (const file of wsFiles) {
      const addedSet = added[file];
      const lines = lcov[file];
      if (!lines) {
        // In scope, ran, but no lcov record → never imported by a test → fully untested.
        results.push({ label: ws.label, file, executable: null, covered: 0, uncovered: [], neverImported: true, addedCount: addedSet.size });
        continue;
      }
      let executable = 0;
      let covered = 0;
      const uncovered = [];
      for (const ln of addedSet) {
        if (!lines.has(ln)) continue; // added line is non-executable (comment/blank/type) — ignore
        executable += 1;
        if (lines.get(ln) > 0) covered += 1;
        else uncovered.push(ln);
      }
      results.push({ label: ws.label, file, executable, covered, uncovered, neverImported: false });
    }
  }

  const out = [];
  out.push(MARKER);
  out.push("## 🧪 Patch coverage (advisory)");
  out.push("");
  out.push(
    "_Non-blocking. Measures how many of the **lines this PR added/changed** are executed by a test — not a whole-file percentage. Low numbers flag code that shipped without a test exercising it._"
  );
  out.push("");

  const assessable = results.filter((r) => r.neverImported || r.executable > 0);

  if (!changedFiles.length) {
    out.push("No changed files detected against `" + BASE_REF + "`.");
  } else if (!ranWorkspaces.length && !skippedWorkspaces.length) {
    out.push("No changed files fall under a coverage-tracked workspace — nothing to assess.");
  } else if (!assessable.length) {
    out.push("No added **executable** lines in coverage-tracked source files — nothing to assess. ✅");
  } else {
    let totalExec = 0;
    let totalCov = 0;
    for (const r of assessable) {
      if (r.neverImported) continue;
      totalExec += r.executable;
      totalCov += r.covered;
    }
    const overall = fmtPct(totalCov, totalExec);
    out.push(`**Overall patch coverage: ${overall}** (${totalCov}/${totalExec} added executable lines covered)`);
    out.push("");
    out.push("| File | Patch coverage | Covered / added-exec | Flag |");
    out.push("| --- | --- | --- | --- |");
    assessable.sort((a, b) => {
      const pa = a.neverImported ? -1 : a.covered / a.executable;
      const pb = b.neverImported ? -1 : b.covered / b.executable;
      return pa - pb;
    });
    for (const r of assessable) {
      if (r.neverImported) {
        out.push(`| \`${r.file}\` | **0%** | 0 / ? | ⚠️ no test imports this file |`);
        continue;
      }
      const pctNum = (r.covered / r.executable) * 100;
      const flag = pctNum < WARN_THRESHOLD ? "⚠️ below " + WARN_THRESHOLD + "%" : "✅";
      let cell = `| \`${r.file}\` | ${fmtPct(r.covered, r.executable)} | ${r.covered} / ${r.executable} | ${flag} |`;
      out.push(cell);
    }
    // Show the specific uncovered added lines for flagged files, to make the warning actionable.
    const flagged = assessable.filter(
      (r) => r.neverImported || (r.executable > 0 && (r.covered / r.executable) * 100 < WARN_THRESHOLD)
    );
    if (flagged.some((r) => r.uncovered.length)) {
      out.push("");
      out.push("<details><summary>Uncovered added lines</summary>");
      out.push("");
      for (const r of flagged) {
        if (!r.uncovered.length) continue;
        out.push(`- \`${r.file}\`: ${compressRanges(r.uncovered)}`);
      }
      out.push("");
      out.push("</details>");
    }
  }

  if (skippedWorkspaces.length) {
    out.push("");
    out.push(
      "> ⚠️ Coverage did not run for some touched workspaces (turbo `--affected` skipped them or the run failed): " +
        skippedWorkspaces.map((s) => `**${s.label}** (${s.count} file${s.count === 1 ? "" : "s"})`).join(", ") +
        ". Those files are not assessed above."
    );
  }

  out.push("");
  out.push(
    `<sub>Base: \`${BASE_REF}\` · threshold: ${WARN_THRESHOLD}% · ran: ${ranWorkspaces.join(", ") || "none"}</sub>`
  );

  process.stdout.write(out.join("\n") + "\n");
}

// [3,4,5,9,10] -> "3-5, 9-10"
function compressRanges(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const parts = [];
  let start = s[0];
  let prev = s[0];
  for (let i = 1; i <= s.length; i++) {
    if (i < s.length && s[i] === prev + 1) {
      prev = s[i];
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = s[i];
    prev = s[i];
  }
  return parts.join(", ");
}

main();
