import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "@playwright/test";
import { DIAGRAM_FIXTURE_NAMES } from "~/tests/visual/diagram-payloads";

/**
 * #1320 real-browser regression, replacing the Happy DOM className-only
 * assertions in eduai-diagram-layout.test.tsx with actual Chromium layout
 * measurements. Two things are checked, matching the two root causes in the
 * #1320 fix commit:
 *
 * 1. Chat scroll container `overflow-x` (the documented CSS spec root
 *    cause): an element with `overflow-y: auto` and no explicit
 *    `overflow-x` computes overflow-x to `auto`, not `visible` — so
 *    oversized content (scrollWidth > clientWidth) silently opens a
 *    horizontal scroll region instead of being clipped/wrapped, reachable
 *    only via a sideways scroll gesture nothing in a chat UI prompts the
 *    user to make. This is exercised below with the real rendered diagram
 *    markup forced to an oversized width, since no catalog payload is
 *    naturally wide enough to trigger it (see point 2).
 *
 * 2. Diagram containment (the defensive hardening): the four catalog
 *    diagrams, rendered via generate-fixtures.tsx against the app's real
 *    compiled CSS, must stay inside a narrow chat column.
 *
 *    #1422 review follow-up: the reviewer's own Chrome check found the
 *    5-stage process-flow payload does not overflow with or without the
 *    w-full/min-w-0 classes when tested with no flex ancestor. To settle
 *    whether an ancestor flex context changes that, generate-fixtures.tsx
 *    now also renders each diagram inside the actual production ancestor
 *    chain (packages/ui Message's `flex gap-3` row -> chat-message.tsx's
 *    `flex flex-col gap-2 flex-1 min-w-0` content column -> the
 *    `mx-auto w-full max-w-3xl` message list), both against a genuine
 *    pre-#1320 component tree (pre1320-components/, a frozen snapshot of
 *    these files from the fix commit's parent) and the current tree. Result
 *    (see the "real chat-message ancestor chain" describe block below):
 *    still no overflow either way, even stress-tested with a 7-stage
 *    payload of much longer labels at a 320px viewport. That's because
 *    `flex-1 min-w-0` on the content column (present before #1320, untouched
 *    by the fix) already resets the one flex item in this chain whose
 *    default min-width could matter; nothing below it is itself a row-axis
 *    flex item, so `flex-wrap` always has a properly-bounded box to wrap
 *    within regardless of the w-full/min-w-0 classes. The decisive,
 *    reproducible-on-base evidence for #1320 is root cause 1, not this one —
 *    the w-full/min-w-0 changes remain as low-risk defensive hardening for
 *    ancestor contexts this integration doesn't currently have.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientBuildDir = path.resolve(__dirname, "../../../build/client");

/**
 * The root CSS asset filename is content-hashed by Vite and changes on every
 * build, so it can't be hardcoded (#1422 review — a clean checkout, or any
 * build after this one, would 404/ENOENT on a fixed name). Resolve it from
 * the client manifest globalSetup.ts just produced instead.
 */
function resolveRootCssPath(): string {
  const manifestPath = path.join(clientBuildDir, ".vite", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<
    string,
    { css?: string[] }
  >;
  const rootEntry = Object.entries(manifest).find(([key]) =>
    key.startsWith("app/root.tsx"),
  )?.[1];
  const cssFile = rootEntry?.css?.[0];
  if (!cssFile) {
    throw new Error(
      `Could not find root.tsx's CSS asset in ${manifestPath} — check the manifest shape hasn't changed.`,
    );
  }
  return path.join(clientBuildDir, cssFile);
}

const CSS = fs.readFileSync(resolveRootCssPath(), "utf8");

// A narrow chat message column — the shape the #1320 bug report actually
// hit (diagram wider than the surrounding chat panel on a normal-width
// screen, not just on mobile).
const COLUMN_WIDTH = 360;

/** Mimics the chat message column the diagram actually renders inside. */
function pageHtml(bodyHtml: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      ${CSS}
      html, body { margin: 0; }
      #column { width: ${COLUMN_WIDTH}px; }
    </style>
  </head>
  <body><div id="column">${bodyHtml}</div></body>
</html>`;
}

/**
 * Mimics the *real* ancestor chain, not just the message column: the
 * `overflow-y-auto`(+/- `overflow-x-hidden`) scroll pane from
 * chat-conversation-layout.tsx, wrapping the `mx-auto w-full max-w-3xl`
 * message list `bodyHtml` (itself already the Message flex row + content
 * column markup — see generate-fixtures.tsx's chat-message fixtures).
 */
function chatScrollPaneHtml(bodyHtml: string, withOverflowXHidden: boolean): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      ${CSS}
      html, body { margin: 0; }
    </style>
  </head>
  <body>
    <div style="width: ${COLUMN_WIDTH}px; height: 900px; overflow-y: auto; ${
      withOverflowXHidden ? "overflow-x: hidden;" : ""
    } overscroll-behavior: contain;">
      <div class="px-4 md:px-6 py-4">
        <div class="mx-auto w-full max-w-3xl space-y-1">${bodyHtml}</div>
      </div>
    </div>
  </body>
</html>`;
}

test.describe("chat scroll container overflow-x (#1320 root cause)", () => {
  /**
   * Same overflow-y-auto/overscroll-contain shape as
   * chat-conversation-layout.tsx, with and without the overflow-x-hidden
   * this PR adds, wrapping the *real* rendered process-flow diagram markup
   * (not a placeholder div — #1422 review) forced to an oversized width via
   * an explicit wrapper. Forcing is necessary because, per the describe
   * block above, no catalog payload is naturally wide enough on its own;
   * this isolates root cause 1 (the scroll-pane overflow-x computation)
   * using real component output for everything downstream of that forced
   * width, matching the bug report's own description of "an eduai-diagram
   * widget wider than its intended column".
   */
  function forcedWideDiagramHtml(withOverflowXHidden: boolean): string {
    const diagramHtml = fs.readFileSync(
      path.resolve(__dirname, "fixtures", "process-flow.html"),
      "utf8",
    );
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      ${CSS}
      html, body { margin: 0; }
      #scroll {
        width: ${COLUMN_WIDTH}px;
        height: 300px;
        overflow-y: auto;
        ${withOverflowXHidden ? "overflow-x: hidden;" : ""}
      }
      #force-wide { display: inline-block; min-width: 900px; }
    </style>
  </head>
  <body><div id="scroll"><div id="force-wide">${diagramHtml}</div></div></body>
</html>`;
  }

  test("without overflow-x-hidden, an oversized real diagram is reachable only via a sideways scroll (pre-fix)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: COLUMN_WIDTH, height: 900 });
    await page.setContent(forcedWideDiagramHtml(false));
    const { overflowX, scrollWidth, clientWidth, shellRight } = await page.evaluate(() => {
      const scroll = document.querySelector("#scroll")!;
      const shell = document.querySelector("[data-eduai-diagram]")!;
      return {
        overflowX: getComputedStyle(scroll).overflowX,
        scrollWidth: scroll.scrollWidth,
        clientWidth: scroll.clientWidth,
        shellRight: shell.getBoundingClientRect().right,
      };
    });
    // The CSS spec quirk the fix commit documents: unset overflow-x next to
    // a non-'visible' overflow-y computes to 'auto', not 'visible'.
    expect(overflowX).toBe("auto");
    // Real overflow exists (not just a computed-style proxy), and the
    // diagram's own box sits past the visible pane — off-screen until the
    // user scrolls sideways, which nothing in the chat UI prompts them to
    // do.
    expect(scrollWidth).toBeGreaterThan(clientWidth);
    expect(shellRight).toBeGreaterThan(COLUMN_WIDTH);
  });

  test("with overflow-x-hidden, the oversized real diagram cannot open a horizontal scroll region (post-fix)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: COLUMN_WIDTH, height: 900 });
    await page.setContent(forcedWideDiagramHtml(true));
    const { overflowX, docScrollWidth } = await page.evaluate(() => ({
      overflowX: getComputedStyle(document.querySelector("#scroll")!).overflowX,
      docScrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflowX).toBe("hidden");
    expect(docScrollWidth).toBeLessThanOrEqual(COLUMN_WIDTH + 1);
  });
});

test.describe("diagram containment in a narrow chat column", () => {
  /**
   * Assert the rendered diagram markup stays fully inside a narrow column:
   * no page-level horizontal overflow, the diagram shell itself never
   * extends past the column bounds, and every visible descendant (a stage
   * chip, an icon, a label) is checked individually against *both* the
   * column and the shell's own clip rectangle (#1422 review: a chip could
   * previously extend past the shell — which owns `overflow-hidden` — while
   * still landing inside the column, and the column-only check would miss
   * that it's actually being clipped).
   */
  async function assertContained(page: Page, bodyHtml: string) {
    await page.setViewportSize({ width: COLUMN_WIDTH, height: 900 });
    await page.setContent(pageHtml(bodyHtml));

    const columnBox = await page.locator("#column").boundingBox();
    expect(columnBox).not.toBeNull();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    // +1px tolerance for sub-pixel rounding.
    expect(scrollWidth).toBeLessThanOrEqual(COLUMN_WIDTH + 1);

    const shellBox = await page.locator("[data-eduai-diagram]").boundingBox();
    expect(shellBox).not.toBeNull();
    expect(shellBox!.x).toBeGreaterThanOrEqual(columnBox!.x - 1);
    expect(shellBox!.x + shellBox!.width).toBeLessThanOrEqual(
      columnBox!.x + columnBox!.width + 1,
    );

    const elementBoxes = await page.evaluate(() => {
      const shell = document.querySelector("[data-eduai-diagram]")!;
      return Array.from(shell.querySelectorAll<HTMLElement | SVGElement>("*"))
        .map((el) => {
          const box = el.getBoundingClientRect();
          return { tag: el.tagName.toLowerCase(), x: box.x, width: box.width, height: box.height };
        })
        .filter((box) => box.width > 0 && box.height > 0);
    });
    expect(elementBoxes.length).toBeGreaterThan(0);
    for (const box of elementBoxes) {
      // Inside the outer column...
      expect(box.x, `${box.tag}: left edge vs column`).toBeGreaterThanOrEqual(columnBox!.x - 1);
      expect(box.x + box.width, `${box.tag}: right edge vs column`).toBeLessThanOrEqual(
        columnBox!.x + columnBox!.width + 1,
      );
      // ...and inside the shell's own clip rectangle, since the shell (not
      // the column) is what actually clips via overflow-hidden.
      expect(box.x, `${box.tag}: left edge vs shell clip`).toBeGreaterThanOrEqual(shellBox!.x - 1);
      expect(box.x + box.width, `${box.tag}: right edge vs shell clip`).toBeLessThanOrEqual(
        shellBox!.x + shellBox!.width + 1,
      );
    }
  }

  for (const name of DIAGRAM_FIXTURE_NAMES) {
    test(`${name} diagram stays within the column`, async ({ page }) => {
      const fixturePath = path.resolve(__dirname, "fixtures", `${name}.html`);
      const html = fs.readFileSync(fixturePath, "utf8");
      await assertContained(page, html);
    });
  }
});

test.describe("diagram containment in the real chat-message ancestor chain (#1422 review)", () => {
  /**
   * The base-vs-head reproduction requested in review: each catalog payload
   * rendered through the actual Message row / content column / max-w-3xl /
   * scroll-pane nesting (see generate-fixtures.tsx's chat-message
   * fixtures), against both a genuine pre-#1320 component tree + pre-#1320
   * scroll pane ("base") and the current tree + pane ("head"). Both are
   * asserted to keep every element visible and unclipped: per the top-of-
   * file comment, this ancestor chain does not reproduce root cause 2 for
   * any catalog payload (the reviewer's own finding, confirmed here against
   * the real DOM shape rather than an isolated diagram). This is still
   * valuable coverage, not a no-op: it locks in that today's real payloads
   * never actually reach the clipping/scrolling boundary the two describe
   * blocks above exercise directly, and it will catch a future regression
   * (e.g. a wider chip, or a flex class removed from the content column)
   * that made that boundary reachable.
   */
  async function assertVisibleAndUnclipped(page: Page, bodyHtml: string, withOverflowXHidden: boolean) {
    await page.setViewportSize({ width: COLUMN_WIDTH, height: 900 });
    await page.setContent(chatScrollPaneHtml(bodyHtml, withOverflowXHidden));

    const docScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(docScrollWidth).toBeLessThanOrEqual(COLUMN_WIDTH + 1);

    const shellBox = await page.locator("[data-eduai-diagram]").boundingBox();
    expect(shellBox).not.toBeNull();
    expect(shellBox!.x + shellBox!.width).toBeLessThanOrEqual(COLUMN_WIDTH + 1);

    const elementBoxes = await page.evaluate(() => {
      const shell = document.querySelector("[data-eduai-diagram]")!;
      return Array.from(shell.querySelectorAll<HTMLElement | SVGElement>("*"))
        .map((el) => el.getBoundingClientRect())
        .filter((box) => box.width > 0 && box.height > 0)
        .map((box) => ({ left: box.x, right: box.x + box.width }));
    });
    expect(elementBoxes.length).toBeGreaterThan(0);
    for (const box of elementBoxes) {
      expect(box.left).toBeGreaterThanOrEqual(-1);
      expect(box.right).toBeLessThanOrEqual(COLUMN_WIDTH + 1);
      expect(box.right, "element must not be clipped by the diagram shell's overflow-hidden").toBeLessThanOrEqual(
        shellBox!.x + shellBox!.width + 1,
      );
    }
  }

  for (const name of DIAGRAM_FIXTURE_NAMES) {
    test(`${name}: base component tree + pre-#1320 scroll pane stays visible and unclipped`, async ({
      page,
    }) => {
      const html = fs.readFileSync(
        path.resolve(__dirname, "fixtures", "chat-message", `${name}-base.html`),
        "utf8",
      );
      await assertVisibleAndUnclipped(page, html, false);
    });

    test(`${name}: head component tree + post-#1320 scroll pane stays visible and unclipped`, async ({
      page,
    }) => {
      const html = fs.readFileSync(
        path.resolve(__dirname, "fixtures", "chat-message", `${name}-head.html`),
        "utf8",
      );
      await assertVisibleAndUnclipped(page, html, true);
    });
  }
});

test.describe("diagram containment during animation playback", () => {
  /**
   * #1318 audit follow-up: every prior #1320 check (this file and the
   * removed tests/browser/diagram-viewport.spec.ts) only asserts a single
   * static layout snapshot -- before/after the fix, or fully settled. None
   * of them actually sample the diagram mid-animation, so a transient
   * overflow that only exists while something is moving (as opposed to in
   * its start/end resting state) would pass every existing check. Only
   * gradient-descent has real motion (an SVG <animateMotion>, 3.2s) rather
   * than opacity/color transitions, so it's the only fixture that can
   * meaningfully regress this way.
   */
  test("gradient-descent stays contained at every point during its animateMotion playback", async ({
    page,
  }) => {
    await page.setViewportSize({ width: COLUMN_WIDTH, height: 900 });
    const html = fs.readFileSync(
      path.resolve(__dirname, "fixtures", "gradient-descent.html"),
      "utf8",
    );
    await page.setContent(pageHtml(html));

    const columnBox = await page.locator("#column").boundingBox();
    expect(columnBox).not.toBeNull();

    // Sample across the full 3.2s animateMotion duration plus settle time.
    const sampleCount = 20;
    for (let i = 0; i <= sampleCount; i++) {
      await page.waitForTimeout(180);
      const { docScrollWidth, maxRight, minLeft } = await page.evaluate(() => {
        const shell = document.querySelector("[data-eduai-diagram]")!;
        let maxRight = shell.getBoundingClientRect().right;
        let minLeft = shell.getBoundingClientRect().left;
        for (const el of shell.querySelectorAll("circle, svg")) {
          const box = el.getBoundingClientRect();
          if (box.width === 0 && box.height === 0) continue;
          maxRight = Math.max(maxRight, box.right);
          minLeft = Math.min(minLeft, box.left);
        }
        return {
          docScrollWidth: document.documentElement.scrollWidth,
          maxRight,
          minLeft,
        };
      });

      expect(docScrollWidth, `frame ${i}: page scrollWidth`).toBeLessThanOrEqual(
        COLUMN_WIDTH + 1,
      );
      expect(maxRight, `frame ${i}: moving marker right edge`).toBeLessThanOrEqual(
        columnBox!.x + columnBox!.width + 1,
      );
      expect(minLeft, `frame ${i}: moving marker left edge`).toBeGreaterThanOrEqual(
        columnBox!.x - 1,
      );
    }
  });
});
