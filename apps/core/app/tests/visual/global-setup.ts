import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreDir = path.resolve(__dirname, "../../..");

/**
 * Regenerates the diagram HTML fixtures from the actual component source
 * before the visual spec runs, via vite-node (see generate-fixtures.tsx for
 * why Playwright can't render the .tsx components itself). Keeps the
 * fixtures from silently going stale relative to the components they're
 * supposed to represent.
 */
export default function globalSetup(): void {
  execFileSync(
    "npx",
    ["vite-node", "--config", "vitest.config.ts", "app/tests/visual/generate-fixtures.tsx"],
    { cwd: coreDir, stdio: "inherit" },
  );
}
