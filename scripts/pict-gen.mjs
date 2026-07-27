#!/usr/bin/env node
/**
 * pict-gen.mjs — Issue #1179 PICT infra.
 *
 * For each tests/models/<name>.pict, runs `pict` inside the pinned docker/pict image and
 * writes tests/models/<name>.cases.json: an array of `{ParamName: "value"}` objects, one per
 * generated row, in the header's column order.
 *
 * Generation always goes through Docker rather than a host-installed `pict`: PICT's greedy
 * solver breaks ties between equally-valid rows via hash-container iteration order, which
 * differs across C++ standard library implementations (e.g. macOS/Homebrew's libc++ vs a Linux
 * build's libstdc++) — same model, same row count, different row selection/order. Since the
 * output is committed and diffed, every environment generating it must agree byte-for-byte, so
 * everyone (local dev or CI) runs the same pinned Linux image. See docker/pict/Dockerfile.
 *
 * Optional per-model sidecar tests/models/<name>.config.json:
 *   { "order": 3, "seed": "<name>.seed.tsv" }
 * `order` maps to PICT's /o:N (2 = pairwise default). `seed` is a path relative to
 * tests/models/, maps to /e:<file> (seed rows pinned into every regen).
 *
 * Usage: node scripts/pict-gen.mjs
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const MODELS_DIR = path.join(process.cwd(), "tests/models");
const DOCKER_DIR = path.join(process.cwd(), "docker/pict");
const IMAGE = "eduai-pict-gen:3.7.4";

function parseTsv(tsv) {
  const lines = tsv.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const unquote = (cell) =>
    cell.length >= 2 && cell[0] === '"' && cell[cell.length - 1] === '"'
      ? cell.slice(1, -1)
      : cell;
  const header = lines[0].split("\t").map(unquote);
  return lines.slice(1).map((line) => {
    const cells = line.split("\t").map(unquote);
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i];
    return row;
  });
}

function loadConfig(modelPath) {
  const configPath = modelPath.replace(/\.pict$/, ".config.json");
  if (!existsSync(configPath)) return {};
  return JSON.parse(readFileSync(configPath, "utf8"));
}

function dockerFail(err) {
  if (err.code === "ENOENT") {
    console.error(
      "pict-gen: the `docker` CLI was not found on PATH.\n" +
        "Docker is a required dependency for this repo (see README \"Getting started\") — install Docker Desktop:\n" +
        "https://www.docker.com/products/docker-desktop/",
    );
  } else {
    console.error("pict-gen: docker failed.");
    console.error(err.stderr?.toString() ?? err.message);
  }
  process.exit(1);
}

function ensureImage() {
  try {
    execFileSync("docker", ["image", "inspect", IMAGE], { stdio: "ignore" });
    return;
  } catch {
    // fall through to build
  }
  try {
    execFileSync("docker", ["build", "-f", path.join(DOCKER_DIR, "Dockerfile"), "-t", IMAGE, DOCKER_DIR], {
      stdio: ["ignore", "ignore", "inherit"],
    });
  } catch (err) {
    dockerFail(err);
  }
}

function runPict(modelPath, config) {
  const args = ["run", "--rm", "-v", `${MODELS_DIR}:/models:ro`, IMAGE, `/models/${path.basename(modelPath)}`];
  if (config.order !== undefined) args.push(`/o:${config.order}`);
  if (config.seed !== undefined) args.push(`/e:/models/${config.seed}`);
  try {
    return execFileSync("docker", args, { encoding: "utf8" });
  } catch (err) {
    if (err.code === "ENOENT") dockerFail(err);
    console.error(`pict-gen: pict failed on ${path.relative(process.cwd(), modelPath)}`);
    console.error(err.stderr?.toString() ?? err.message);
    process.exit(1);
  }
}

function main() {
  if (!existsSync(MODELS_DIR)) {
    console.error(`pict-gen: no ${path.relative(process.cwd(), MODELS_DIR)} directory found.`);
    process.exit(1);
  }

  const modelFiles = readdirSync(MODELS_DIR)
    .filter((f) => f.endsWith(".pict"))
    .sort();

  if (modelFiles.length === 0) {
    console.log("pict-gen: no *.pict models found under tests/models/ — nothing to do.");
    return;
  }

  ensureImage();

  for (const file of modelFiles) {
    const modelPath = path.join(MODELS_DIR, file);
    const config = loadConfig(modelPath);
    const tsv = runPict(modelPath, config);
    const rows = parseTsv(tsv);
    const outPath = modelPath.replace(/\.pict$/, ".cases.json");
    writeFileSync(outPath, JSON.stringify(rows, null, 2) + "\n");
    console.log(`pict-gen: ${file} -> ${path.basename(outPath)} (${rows.length} rows)`);
  }
}

main();
