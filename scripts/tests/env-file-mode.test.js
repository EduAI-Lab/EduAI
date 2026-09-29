// #1881: setup-env.js env-file permissions — configurable mode, no EPERM crash.
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, statSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const {
  DEFAULT_ENV_FILE_MODE,
  applyEnvFileMode,
  resolveEnvFileMode,
} = require("../lib/env-file-mode");

const errorWithCode = (code) => Object.assign(new Error(code), { code });

test("resolveEnvFileMode defaults to owner-only when unset or blank", () => {
  assert.equal(DEFAULT_ENV_FILE_MODE, 0o600);
  assert.equal(resolveEnvFileMode(undefined), 0o600);
  assert.equal(resolveEnvFileMode(""), 0o600);
  assert.equal(resolveEnvFileMode("   "), 0o600);
});

test("resolveEnvFileMode accepts owner/group modes with or without a leading 0", () => {
  assert.equal(resolveEnvFileMode("0660"), 0o660);
  assert.equal(resolveEnvFileMode("660"), 0o660);
  assert.equal(resolveEnvFileMode("0640"), 0o640);
  assert.equal(resolveEnvFileMode(" 0600 "), 0o600);
});

test("resolveEnvFileMode refuses world-readable, executable or malformed modes", () => {
  for (const bad of ["0644", "0666", "0777", "0700", "0770", "600x", "rw-rw----", "10660"]) {
    assert.throws(() => resolveEnvFileMode(bad), /EDUAI_ENV_FILE_MODE/, bad);
  }
});

test("applyEnvFileMode chmods every path with the requested mode", () => {
  const calls = [];
  const result = applyEnvFileMode(["a/.env", "b/.env"], 0o660, {
    chmod: (path, mode) => calls.push([path, mode]),
    warn: () => assert.fail("should not warn"),
  });
  assert.deepEqual(calls, [
    ["a/.env", 0o660],
    ["b/.env", 0o660],
  ]);
  assert.deepEqual(result.skipped, []);
});

test("applyEnvFileMode warns and continues when not the file owner (EPERM/EACCES)", () => {
  const warnings = [];
  const chmodded = [];
  const result = applyEnvFileMode(["owned-by-other/.env", "locked/.env", "mine/.env"], 0o660, {
    chmod: (path) => {
      if (path.startsWith("owned-by-other")) throw errorWithCode("EPERM");
      if (path.startsWith("locked")) throw errorWithCode("EACCES");
      chmodded.push(path);
    },
    warn: (message) => warnings.push(message),
  });
  assert.deepEqual(result.skipped, ["owned-by-other/.env", "locked/.env"]);
  assert.deepEqual(chmodded, ["mine/.env"]);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /owned-by-other\/\.env.*0660.*EPERM/);
});

test("applyEnvFileMode still throws unexpected errors", () => {
  assert.throws(
    () =>
      applyEnvFileMode(["missing/.env"], 0o600, {
        chmod: () => {
          throw errorWithCode("ENOENT");
        },
        warn: () => {},
      }),
    /ENOENT/,
  );
});

test("applyEnvFileMode sets the real mode on disk", { skip: process.platform === "win32" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "env-file-mode-"));
  try {
    const file = join(dir, ".env");
    writeFileSync(file, "KEY=value\n", { mode: 0o600 });
    applyEnvFileMode([file], 0o660);
    assert.equal(statSync(file).mode & 0o777, 0o660);
    applyEnvFileMode([file], 0o600);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
