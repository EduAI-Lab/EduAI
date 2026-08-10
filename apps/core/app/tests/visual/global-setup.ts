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
 *
 * Also (re)builds Core so the spec has a real, current compiled Tailwind CSS
 * to test against — a clean checkout has no `build/` directory at all, and
 * diagram-overflow.spec.ts resolves the actual CSS asset name from the Vite
 * client manifest this build produces, since the filename is content-hashed
 * and changes on every build (#1422 review). Always rebuilds rather than
 * skipping when `build/` exists, for the same staleness reason the fixtures
 * are always regenerated: a spec asserting real compiled CSS is only
 * trustworthy if that CSS actually reflects the current source.
 */
export default function globalSetup(): void {
  execFileSync("npm", ["run", "build"], { cwd: coreDir, stdio: "inherit" });
  execFileSync(
    "npx",
    ["vite-node", "--config", "vitest.config.ts", "app/tests/visual/generate-fixtures.tsx"],
    { cwd: coreDir, stdio: "inherit" },
  );
}
