import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Normalize CRLF so a Windows checkout parses and checks the same as CI.
const read = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const source = read(path.join(root, "docs/ONBOARDING.md"));
const pages = {};
for (const section of source.split(/^## /m).slice(1)) {
  const [heading, ...lines] = section.split("\n");
  const match = heading.match(/^(core|ai-tutor|question-maker)\.([a-z]+): (.+)$/);
  if (!match) throw new Error(`Invalid onboarding heading: ${heading}`);
  const [, platform, page, title] = match;
  const id = `${platform}.${page}`;
  if (pages[id]) throw new Error(`Duplicate onboarding page: ${id}`);
  const task = lines.find((line) => line.startsWith("Task: "))?.slice(6);
  const staffTask = lines.find((line) => line.startsWith("Staff task: "))?.slice(12);
  const steps = lines.flatMap((line) => {
    const step = line.match(/^\d+\. \*\*(.+)\*\* — (.+)$/);
    return step ? [{ id: `${id}.${step[1]}`, title: step[1], body: step[2] }] : [];
  });
  if (!task || !staffTask || steps.length < 2) throw new Error(`Incomplete page: ${id}`);
  pages[id] = { title, task, staffTask, steps };
}
for (const platform of ["core", "ai-tutor", "question-maker"]) {
  if (Object.keys(pages).filter((id) => id.startsWith(`${platform}.`)).length !== 5) {
    throw new Error(`${platform} must have exactly five pages`);
  }
}
const output = `// Generated from docs/ONBOARDING.md by scripts/generate-onboarding.mjs.\n// Do not edit; run npm run onboarding:generate.\nexport const ONBOARDING_PAGES = ${JSON.stringify(pages, null, 2)} as const;\n`;
const destination = path.join(root, "packages/ui/src/onboarding/generated/pages.ts");
if (process.argv.includes("--check")) {
  if (read(destination) !== output) {
    throw new Error("Onboarding copy is stale. Run npm run onboarding:generate.");
  }
} else {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, output);
}
