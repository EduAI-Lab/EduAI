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

/** Non-enumerable key so mapping stats never collide with a real file path. */
const MAPPING_STATS = Symbol("lcovMappingStats");

/**
 * Normalize one lcov `SF:` path to a repo-relative POSIX path.
 *
 * There is no single convention here, which is what previously broke this
 * script: vitest's lcov reporter writes paths relative to the WORKSPACE root
 * (`SF:src/spinner.tsx` inside `packages/ui/coverage/lcov.info`), while other
 * tools emit absolute paths or paths relative to the coverage directory.
 * Resolving against one fixed base silently mismatched every file and made the
 * whole report read "0% — no test imports this file".
 *
 * So try each convention and prefer whichever actually names a file on disk.
 *
 * Returns `{ rel, resolved }`. `resolved` is false when no candidate existed,
 * which is the single source of truth for "this record did not map" — callers
 * must not re-derive it, or the rules end up encoded in two places.
 */
function resolveLcovPath(sf, covDir) {
  const toRel = (abs) => path.relative(REPO_ROOT, abs).split(path.sep).join("/");

  if (path.isAbsolute(sf)) {
    return { rel: toRel(sf), resolved: fs.existsSync(sf) };
  }

  const wsRoot = path.resolve(REPO_ROOT, covDir, "..");
  // ORDER IS LOAD-BEARING: first existing candidate wins, so workspace-root beats
  // coverage-dir. Every covDir in WORKSPACES ends in `coverage/`, so `covDir/..`
  // is always the workspace root and no real source file exists at both readings.
  // Do not reshuffle without rechecking that.
  const candidates = [
    path.resolve(wsRoot, sf), // vitest: relative to the workspace root
    path.resolve(REPO_ROOT, covDir, sf), // relative to the coverage dir
    path.resolve(REPO_ROOT, sf), // already repo-relative
  ];

  for (const abs of candidates) {
    if (fs.existsSync(abs)) return { rel: toRel(abs), resolved: true };
  }
  // Nothing resolved — e.g. an lcov record naming a file deleted after coverage
  // was generated. (Files deleted in the PR itself never reach here: the diff is
  // read with --diff-filter=d.) Fall back to the workspace-root reading, which is
  // correct for every generator we use.
  return { rel: toRel(candidates[0]), resolved: false };
}

// path -> Map(lineNumber -> hits) for one lcov.info, keyed repo-relative so the
// keys match the diff's paths. Returns null when the workspace did not run.
function parseLcov(covDir) {
  const file = path.join(REPO_ROOT, covDir, "lcov.info");
  if (!fs.existsSync(file)) return null; // workspace did not run this PR
  const byFile = {};
  let current = null;
  let records = 0;
  let resolved = 0;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const lineStr = raw.trim();
    if (lineStr.startsWith("SF:")) {
      const mapped = resolveLcovPath(lineStr.slice(3), covDir);
      records += 1;
      if (mapped.resolved) resolved += 1;
      current = byFile[mapped.rel] || (byFile[mapped.rel] = new Map());
    } else if (lineStr.startsWith("DA:") && current) {
      const [ln, hits] = lineStr.slice(3).split(",");
      current.set(parseInt(ln, 10), parseInt(hits, 10));
    } else if (lineStr === "end_of_record") {
      current = null;
    }
  }
  // A total mapping failure is a bug in this script, not a coverage result. Say
  // so rather than emitting a wall of "0% — no test imports this file" rows that
  // are indistinguishable from genuinely untested code.
  Object.defineProperty(byFile, MAPPING_STATS, {
    value: { records, resolved },
    enumerable: false,
  });
  return byFile;
}

/**
 * True when a workspace's lcov parsed but not one record named a file on disk.
 *
 * Worth keeping deliberately: if coverage were ever produced under a different
 * filesystem root (a container path, a different checkout dir), every absolute
 * `SF:` would resolve to nothing, and this turns the workspace into "no data +
 * a loud warning" instead of a wall of false 0%s. That is the right failure
 * direction for a signal humans read at a glance.
 *
 * It is deliberately a heuristic aimed at that degenerate case: one
 * accidentally-resolving record disarms it, and a PARTIAL mapping failure still
 * reports its unmapped files as 0%. A ratio test (resolved / records < 0.5)
 * would catch partials too — left until something motivates it.
 */
function lcovMappingBroken(lcov) {
  const stats = lcov && lcov[MAPPING_STATS];
  return Boolean(stats && stats.records > 0 && stats.resolved === 0);
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
  const brokenWorkspaces = [];

  for (const ws of WORKSPACES) {
    const lcov = parseLcov(ws.covDir);
    const wsFiles = changedFiles.filter(
      (f) => f.startsWith(ws.srcPrefix) && ws.ext.test(f) && !ws.exclude(f)
    );
    if (lcov === null) {
      if (wsFiles.length) skippedWorkspaces.push({ label: ws.label, count: wsFiles.length });
      continue; // no coverage data — turbo --affected didn't select it (or it failed)
    }
    if (lcovMappingBroken(lcov)) {
      // Every SF: record failed to name a file on disk. Reporting these as 0%
      // would be indistinguishable from genuinely untested code, so report the
      // mapping failure itself and leave the files out of the numbers.
      brokenWorkspaces.push({ label: ws.label, covDir: ws.covDir, count: wsFiles.length });
      continue;
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

  const assessable = results.filter((r) => r.neverImported || r.executable > 0);
  const flagged = assessable.filter(
    (r) => r.neverImported || (r.covered / r.executable) * 100 < WARN_THRESHOLD
  );
  let totalExec = 0;
  let totalCov = 0;
  for (const r of assessable) {
    if (r.neverImported) continue;
    totalExec += r.executable;
    totalCov += r.covered;
  }

  const out = [];
  out.push(MARKER);

  // Lead with the verdict + numbers — the part that stays useful once the check is familiar.
  if (!changedFiles.length) {
    out.push("### 🧪 Patch coverage — no changes");
    out.push("");
    out.push(`Nothing changed against \`${BASE_REF}\`.`);
  } else if (!ranWorkspaces.length && !skippedWorkspaces.length) {
    out.push("### 🧪 Patch coverage — n/a");
    out.push("");
    out.push("No changed files fall under a coverage-tracked workspace.");
  } else if (!assessable.length) {
    out.push("### 🧪 Patch coverage — n/a ✅");
    out.push("");
    out.push("No added executable lines in tracked source files (changes were config, comments, or types).");
  } else {
    const verdict = flagged.length ? "⚠️" : "✅";
    out.push(`### 🧪 Patch coverage: ${fmtPct(totalCov, totalExec)} ${verdict}`);
    out.push("");
    const nFiles = assessable.length;
    let sub = `**${totalCov}/${totalExec}** added executable lines covered across **${nFiles}** file${nFiles === 1 ? "" : "s"}.`;
    sub += flagged.length
      ? ` **${flagged.length} flagged** below ${WARN_THRESHOLD}% — see below. 👇`
      : ` All at or above ${WARN_THRESHOLD}%. Nothing to action.`;
    out.push(sub);
    out.push("");

    out.push("| File | Coverage | Covered / added | |");
    out.push("| --- | --: | --: | --- |");
    assessable.sort((a, b) => {
      const pa = a.neverImported ? -1 : a.covered / a.executable;
      const pb = b.neverImported ? -1 : b.covered / b.executable;
      return pa - pb; // worst first
    });
    for (const r of assessable) {
      if (r.neverImported) {
        out.push(`| \`${r.file}\` | **0%** | 0 / ${r.addedCount} | ⚠️ no test imports this file |`);
        continue;
      }
      const pctNum = (r.covered / r.executable) * 100;
      const mark = pctNum < WARN_THRESHOLD ? "⚠️" : "✅";
      out.push(`| \`${r.file}\` | ${fmtPct(r.covered, r.executable)} | ${r.covered} / ${r.executable} | ${mark} |`);
    }

    // Exact uncovered lines for flagged files — the actionable payload.
    if (flagged.length) {
      out.push("");
      out.push(`<details open><summary><strong>Uncovered added lines</strong> (${flagged.length} file${flagged.length === 1 ? "" : "s"})</summary>`);
      out.push("");
      for (const r of flagged) {
        if (r.neverImported) {
          out.push(`- \`${r.file}\` — entire file (${r.addedCount} added line${r.addedCount === 1 ? "" : "s"}); no test imports it`);
        } else if (r.uncovered.length) {
          out.push(`- \`${r.file}\` — lines ${compressRanges(r.uncovered)}`);
        }
      }
      out.push("");
      out.push("</details>");
    }
  }

  if (skippedWorkspaces.length) {
    out.push("");
    out.push(
      "> ⚠️ Not assessed — coverage didn't run for " +
        skippedWorkspaces.map((s) => `**${s.label}** (${s.count} file${s.count === 1 ? "" : "s"})`).join(", ") +
        ` (turbo \`--affected\` skipped it or the suite failed).`
    );
  }

  // Loud, because this is a defect in this script rather than a coverage result,
  // and it previously masqueraded as "every file is 0%".
  if (brokenWorkspaces.length) {
    out.push("");
    out.push(
      "> 🛠️ **Coverage data could not be mapped to files** for " +
        brokenWorkspaces
          .map((b) => `**${b.label}** (\`${b.covDir}/lcov.info\`, ${b.count} changed file${b.count === 1 ? "" : "s"})`)
          .join(", ") +
        ". Every `SF:` record failed to resolve to a path on disk, so those files are excluded from the numbers above rather than reported as 0%. This is a bug in `pr-patch-coverage.js`, not a coverage finding — see #1192."
    );
  }

  out.push("");
  out.push(
    `<sub>base \`${BASE_REF}\` · threshold ${WARN_THRESHOLD}% · ran ${ranWorkspaces.join(", ") || "none"} · advisory, never blocks merge</sub>`
  );
  out.push("");
  out.push("<details><summary>What is patch coverage?</summary>");
  out.push("");
  out.push(
    "The share of the lines **this PR added or changed** that a test executes — not a whole-file %, which is noisy (it swings on unrelated deletions and moves). A low number means new code shipped without a test running it. A file that no test imports shows as 0%."
  );
  out.push("");
  out.push("</details>");

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

module.exports = {
  resolveLcovPath,
  parseLcov,
  lcovMappingBroken,
  addedLinesByFile,
  compressRanges,
  fmtPct,
  MAPPING_STATS,
};

if (require.main === module) {
  main();
}
