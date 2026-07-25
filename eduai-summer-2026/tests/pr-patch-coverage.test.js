const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

// The script reads REPO_ROOT at require time, so point it at a scratch repo
// before loading it. Each test builds the real on-disk layout it needs, since
// path resolution is exactly what we are testing.
const REPO_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "patch-cov-"));
process.env.REPO_ROOT = REPO_ROOT;

const {
  resolveLcovPath,
  parseLcov,
  lcovMappingBroken,
  compressRanges,
  fmtPct,
} = require("../scripts/pr-patch-coverage");

function write(relPath, contents = "") {
  const abs = path.join(REPO_ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
  return abs;
}

test.after(() => fs.rmSync(REPO_ROOT, { recursive: true, force: true }));

test("resolveLcovPath maps vitest's workspace-root-relative SF path", () => {
  // The regression from #1192: vitest writes `SF:src/spinner.tsx` into
  // packages/ui/coverage/lcov.info, meaning packages/ui/src/spinner.tsx.
  write("packages/ui/src/spinner.tsx");
  assert.equal(
    resolveLcovPath("src/spinner.tsx", "packages/ui/coverage"),
    "packages/ui/src/spinner.tsx",
  );
});

test("resolveLcovPath does not resolve into the coverage directory", () => {
  write("packages/ui/src/permission-gate.tsx");
  const resolved = resolveLcovPath("src/permission-gate.tsx", "packages/ui/coverage");
  assert.ok(!resolved.includes("/coverage/"), `resolved into coverage dir: ${resolved}`);
});

test("resolveLcovPath accepts a coverage-dir-relative SF path", () => {
  write("packages/ui/coverage/generated/thing.ts");
  assert.equal(
    resolveLcovPath("generated/thing.ts", "packages/ui/coverage"),
    "packages/ui/coverage/generated/thing.ts",
  );
});

test("resolveLcovPath accepts an absolute SF path", () => {
  const abs = write("apps/core/app/root.tsx");
  assert.equal(resolveLcovPath(abs, "apps/core/coverage"), "apps/core/app/root.tsx");
});

test("resolveLcovPath falls back to the workspace root when nothing exists on disk", () => {
  // e.g. a file deleted later in the branch — still keyed the way vitest meant it.
  assert.equal(
    resolveLcovPath("src/gone.tsx", "packages/ui/coverage"),
    "packages/ui/src/gone.tsx",
  );
});

test("parseLcov keys records by repo-relative source path with hit counts", () => {
  write("packages/ui/src/spinner.tsx");
  write(
    "packages/ui/coverage/lcov.info",
    ["SF:src/spinner.tsx", "DA:1,3", "DA:2,0", "end_of_record", ""].join("\n"),
  );

  const parsed = parseLcov("packages/ui/coverage");
  const lines = parsed["packages/ui/src/spinner.tsx"];
  assert.ok(lines, "expected the source file to be keyed repo-relative");
  assert.equal(lines.get(1), 3);
  assert.equal(lines.get(2), 0);
});

test("parseLcov returns null when the workspace did not run", () => {
  assert.equal(parseLcov("apps/nope/coverage"), null);
});

test("lcovMappingBroken is false when records resolve", () => {
  write("packages/ui/src/sign-out-card.tsx");
  write(
    "packages/ui/coverage/lcov.info",
    ["SF:src/sign-out-card.tsx", "DA:1,1", "end_of_record", ""].join("\n"),
  );
  assert.equal(lcovMappingBroken(parseLcov("packages/ui/coverage")), false);
});

test("lcovMappingBroken flags a total mapping failure", () => {
  // Every record names something that is not on disk. Reporting these as 0%
  // is what made the broken script look like a catastrophic coverage finding.
  write(
    "apps/extensions/ai-tutor/coverage/lcov.info",
    ["SF:src/does-not-exist.tsx", "DA:1,0", "end_of_record", ""].join("\n"),
  );
  assert.equal(lcovMappingBroken(parseLcov("apps/extensions/ai-tutor/coverage")), true);
});

test("lcovMappingBroken is false for an empty lcov", () => {
  // No records is "nothing ran", not "mapping is broken".
  write("apps/core/coverage/lcov.info", "");
  assert.equal(lcovMappingBroken(parseLcov("apps/core/coverage")), false);
});

test("mapping stats do not leak into the file keys", () => {
  write("packages/ui/src/spinner.tsx");
  write(
    "packages/ui/coverage/lcov.info",
    ["SF:src/spinner.tsx", "DA:1,1", "end_of_record", ""].join("\n"),
  );
  const parsed = parseLcov("packages/ui/coverage");
  assert.deepEqual(Object.keys(parsed), ["packages/ui/src/spinner.tsx"]);
});

test("compressRanges collapses consecutive lines", () => {
  assert.equal(compressRanges([3, 4, 5, 9, 10]), "3-5, 9-10");
  assert.equal(compressRanges([7]), "7");
  assert.equal(compressRanges([2, 4, 6]), "2, 4, 6");
});

test("fmtPct renders a dash when there is nothing executable", () => {
  assert.equal(fmtPct(0, 0), "—");
  assert.equal(fmtPct(1, 2), "50.0%");
  assert.equal(fmtPct(3, 3), "100.0%");
});
