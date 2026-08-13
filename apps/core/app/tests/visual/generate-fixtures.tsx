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
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnimatedProcessFlow } from "~/components/chat/diagrams/animated-process-flow";
import { AnimatedHierarchy } from "~/components/chat/diagrams/animated-hierarchy";
import { AnimatedCompare } from "~/components/chat/diagrams/animated-compare";
import { AnimatedGradientDescent } from "~/components/chat/diagrams/animated-gradient-descent";
import { AnimatedProcessFlow as BaseAnimatedProcessFlow } from "~/tests/visual/pre1320-components/animated-process-flow";
import { AnimatedHierarchy as BaseAnimatedHierarchy } from "~/tests/visual/pre1320-components/animated-hierarchy";
import { AnimatedCompare as BaseAnimatedCompare } from "~/tests/visual/pre1320-components/animated-compare";
import { AnimatedGradientDescent as BaseAnimatedGradientDescent } from "~/tests/visual/pre1320-components/animated-gradient-descent";
import {
  processFlowPayload,
  hierarchyPayload,
  comparePayload,
  gradientDescentPayload,
} from "~/tests/visual/diagram-payloads";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "fixtures");
const messageDir = path.join(outDir, "chat-message");
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(messageDir, { recursive: true });

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

/**
 * Mirrors the real ancestor chain a diagram renders inside (chat-message.tsx
 * -> packages/ui Message): a `flex gap-3` row with a `shrink-0` avatar next
 * to a `flex flex-col gap-2 flex-1 min-w-0` content column. The avatar is a
 * plain fixed-size placeholder div (not the real Avatar component) since
 * only its footprint in the flex row matters here, not its image-loading
 * behavior. This is the #1422-review base-vs-head reproduction: the earlier
 * bare-diagram fixtures above render with no flex ancestor at all, which the
 * reviewer found does not reproduce the flex `min-width: auto` overflow
 * described in the fix commit.
 */
function chatMessageRow(diagram: ReactNode): string {
  return renderToStaticMarkup(
    <div className="flex gap-3">
      <div className="h-8 w-8 shrink-0 rounded-full bg-muted" />
      <div className="flex flex-col gap-2 flex-1 min-w-0">{diagram}</div>
    </div>,
  );
}

const messageFixtures: Record<string, { base: string; head: string }> = {
  "process-flow": {
    base: chatMessageRow(<BaseAnimatedProcessFlow payload={processFlowPayload} />),
    head: chatMessageRow(<AnimatedProcessFlow payload={processFlowPayload} />),
  },
  hierarchy: {
    base: chatMessageRow(<BaseAnimatedHierarchy payload={hierarchyPayload} />),
    head: chatMessageRow(<AnimatedHierarchy payload={hierarchyPayload} />),
  },
  compare: {
    base: chatMessageRow(<BaseAnimatedCompare payload={comparePayload} />),
    head: chatMessageRow(<AnimatedCompare payload={comparePayload} />),
  },
  "gradient-descent": {
    base: chatMessageRow(<BaseAnimatedGradientDescent payload={gradientDescentPayload} />),
    head: chatMessageRow(<AnimatedGradientDescent payload={gradientDescentPayload} />),
  },
};

for (const [name, { base, head }] of Object.entries(messageFixtures)) {
  fs.writeFileSync(path.join(messageDir, `${name}-base.html`), base, "utf8");
  fs.writeFileSync(path.join(messageDir, `${name}-head.html`), head, "utf8");
}

console.log(
  `[diagram-visual] wrote ${Object.keys(fixtures).length} fixtures to ${outDir}, ` +
    `${Object.keys(messageFixtures).length * 2} chat-message base/head fixtures to ${messageDir}`,
);
