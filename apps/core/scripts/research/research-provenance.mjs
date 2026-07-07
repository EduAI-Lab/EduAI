/**
 * Provenance metadata for reproducible research runs.
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolvePromptsPath, SUITE_DIR } from "./paths.mjs";

function resolveManifestPath() {
  const candidates = [
    join(SUITE_DIR, "REPRODUCIBILITY_MANIFEST.json"),
    join(SUITE_DIR, "..", "REPRODUCIBILITY_MANIFEST.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

export function resolveGitSha() {
  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function sha256File(path) {
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  return createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

export function buildRunProvenance() {
  const promptsPath = resolvePromptsPath();
  const manifestPath = resolveManifestPath();
  const suiteVersion =
    process.env.RESEARCH_SUITE_VERSION?.trim().toLowerCase() === "v2" ? "v2" : "v1";
  return {
    git_sha: resolveGitSha(),
    suite_version: suiteVersion,
    prompts_path: promptsPath,
    prompts_sha256: sha256File(promptsPath),
    manifest_sha256: sha256File(manifestPath),
    router_version_frozen: "v1-rules",
    router_freeze_date: "2026-06-27",
  };
}
