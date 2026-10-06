const { chmodSync, statSync } = require("fs");

/**
 * #1881: permission bits setup-env.js applies to every generated .env / .env.test.
 *
 * Default stays owner-only (0600) so a laptop checkout keeps its secrets private.
 * A shared host where services run as different accounts in one group (s378:
 * Core as the checkout owner, the cron worker as `eduai-cron` in `eduai-dev`)
 * sets EDUAI_ENV_FILE_MODE=0660 so those accounts can still read the files.
 * Only owner/group modes are accepted: an env file holds secrets, so a
 * world-readable or executable mode is refused rather than applied.
 */
const DEFAULT_ENV_FILE_MODE = 0o600;
const ALLOWED_ENV_FILE_MODES = new Set([0o600, 0o640, 0o660]);

/** Parse EDUAI_ENV_FILE_MODE ("660" or "0660"); unset → default, anything else → error. */
function resolveEnvFileMode(raw) {
  if (raw === undefined || raw.trim() === "") return DEFAULT_ENV_FILE_MODE;
  const value = raw.trim();
  if (!/^0?[0-7]{3}$/.test(value)) {
    throw new Error(`EDUAI_ENV_FILE_MODE must be an octal mode like 0600 or 0660, got "${raw}"`);
  }
  const mode = parseInt(value, 8);
  if (!ALLOWED_ENV_FILE_MODES.has(mode)) {
    throw new Error(
      `EDUAI_ENV_FILE_MODE ${value} is not allowed for secret files; use 0600, 0640 or 0660`,
    );
  }
  return mode;
}

/** Why chmod was refused, in terms an operator can act on. */
const CHMOD_FAILURE_REASON = {
  EPERM: "not the file owner",
  EACCES: "a parent directory is not searchable",
};

/**
 * Set each env file's mode, but never abort the install over it.
 *
 * - `explicit` (EDUAI_ENV_FILE_MODE was set): every file gets `mode`.
 * - otherwise a file is only chmodded when this run `created` it or its current
 *   mode is not an allowed secret mode (e.g. world-readable 0644). An existing
 *   0600/0640/0660 file is left alone, so a shared host's group-readable files
 *   (s378: 0660 for the eduai-cron worker) survive a plain `npm install` that
 *   didn't go through go-live-build.sh (#1886 review).
 *
 * Only the owner (or root) may chmod, so a non-owner gets EPERM; that used to
 * kill the whole postinstall. Warn and leave the current mode instead. Any
 * other error still throws.
 */
function applyEnvFileMode(
  paths,
  mode,
  {
    explicit = false,
    created = new Set(),
    chmod = chmodSync,
    stat = statSync,
    warn = console.warn,
  } = {},
) {
  const skipped = [];
  const kept = [];
  for (const path of paths) {
    if (!explicit && !created.has(path)) {
      const current = stat(path).mode & 0o777;
      if (ALLOWED_ENV_FILE_MODES.has(current)) {
        kept.push(path);
        continue;
      }
    }
    try {
      chmod(path, mode);
    } catch (error) {
      const reason = error && CHMOD_FAILURE_REASON[error.code];
      if (reason) {
        skipped.push(path);
        warn(
          `  warning: could not chmod ${path} to ${mode.toString(8).padStart(4, "0")} ` +
            `(${error.code}: ${reason}); leaving its current mode`,
        );
        continue;
      }
      throw error;
    }
  }
  return { skipped, kept };
}

module.exports = {
  ALLOWED_ENV_FILE_MODES,
  DEFAULT_ENV_FILE_MODE,
  applyEnvFileMode,
  resolveEnvFileMode,
};
