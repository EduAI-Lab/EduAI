/**
 * Assert-only (#1189, census § S10): extensions hold zero code imports of each
 * other — they link only through Core ids and nav URLs (extension-urls).
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// apps/core/app/tests/unit → five levels up to the monorepo root
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

const AT_ROOT = path.join(repoRoot, "apps/extensions/ai-tutor");
const QM_ROOT = path.join(repoRoot, "apps/extensions/question-maker");

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) {
    throw new Error(`ext-ext-isolation: missing scan root: ${dir}`);
  }
  const entries = readdirSync(dir);
  for (const name of entries) {
    if (name === "node_modules" || name === "dist" || name === "build" || name === ".git") {
      continue;
    }
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (CODE_EXT.has(path.extname(name))) out.push(full);
  }
  return out;
}

/** Import / require / dynamic-import paths that reach into the other extension. */
const AT_FORBIDDEN: RegExp[] = [
  /from\s+['"][^'"]*(?:question-maker|apps\/extensions\/question-maker)[^'"]*['"]/,
  /require\(\s*['"][^'"]*(?:question-maker|apps\/extensions\/question-maker)[^'"]*['"]\s*\)/,
  /import\s*\(\s*['"][^'"]*(?:question-maker|apps\/extensions\/question-maker)[^'"]*['"]\s*\)/,
];

const QM_FORBIDDEN: RegExp[] = [
  /from\s+['"][^'"]*(?:ai-tutor|apps\/extensions\/ai-tutor)[^'"]*['"]/,
  /require\(\s*['"][^'"]*(?:ai-tutor|apps\/extensions\/ai-tutor)[^'"]*['"]\s*\)/,
  /import\s*\(\s*['"][^'"]*(?:ai-tutor|apps\/extensions\/ai-tutor)[^'"]*['"]\s*\)/,
];

function findViolations(root: string, patterns: RegExp[]): string[] {
  const hits: string[] = [];
  for (const file of walk(root)) {
    const text = readFileSync(file, "utf8");
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        hits.push(path.relative(repoRoot, file));
        break;
      }
    }
  }
  return hits;
}

describe("ext↔ext isolation (assert-only)", () => {
  it("AI Tutor source does not import Question Maker", () => {
    expect(findViolations(AT_ROOT, AT_FORBIDDEN)).toEqual([]);
  });

  it("Question Maker source does not import AI Tutor", () => {
    expect(findViolations(QM_ROOT, QM_FORBIDDEN)).toEqual([]);
  });
});
