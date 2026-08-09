/**
 * Renders the four animated diagram components to static HTML for the
 * #1320 real-browser layout regression (diagram-overflow.spec.ts).
 *
 * Run via vite-node, not Playwright: Playwright's own transform hardcodes
 * `jsxImportSource` to its own package (for built-in component testing),
 * which silently produces non-React elements for any .tsx it touches —
 * there's no config knob to opt a file out of that. Rendering here, in a
 * separate vite-node process using the app's real vitest/vite config (same
 * tsconfig-paths aliases the Happy DOM unit tests use), keeps this on the
 * toolchain that's actually verified to render these components correctly,
 * and the Playwright spec only ever reads the resulting plain HTML files.
 *
 *   npx vite-node --config vitest.config.ts app/tests/visual/generate-fixtures.tsx
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { AnimatedProcessFlow } from "~/components/chat/diagrams/animated-process-flow";
import { AnimatedHierarchy } from "~/components/chat/diagrams/animated-hierarchy";
import { AnimatedCompare } from "~/components/chat/diagrams/animated-compare";
import { AnimatedGradientDescent } from "~/components/chat/diagrams/animated-gradient-descent";
import {
  processFlowPayload,
  hierarchyPayload,
  comparePayload,
  gradientDescentPayload,
} from "~/tests/visual/diagram-payloads";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "fixtures");
fs.mkdirSync(outDir, { recursive: true });

const fixtures: Record<string, string> = {
  "process-flow": renderToStaticMarkup(<AnimatedProcessFlow payload={processFlowPayload} />),
  hierarchy: renderToStaticMarkup(<AnimatedHierarchy payload={hierarchyPayload} />),
  compare: renderToStaticMarkup(<AnimatedCompare payload={comparePayload} />),
  "gradient-descent": renderToStaticMarkup(
    <AnimatedGradientDescent payload={gradientDescentPayload} />,
  ),
};

for (const [name, html] of Object.entries(fixtures)) {
  fs.writeFileSync(path.join(outDir, `${name}.html`), html, "utf8");
}

console.log(`[diagram-visual] wrote ${Object.keys(fixtures).length} fixtures to ${outDir}`);
