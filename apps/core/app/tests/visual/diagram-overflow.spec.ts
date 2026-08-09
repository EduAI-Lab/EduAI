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
 *    user to make. Verified against both the pre-fix shape
 *    (`overflow-y-auto` only — computed overflow-x is `auto`) and the fix
 *    (`overflow-x-hidden` added — computed overflow-x is `hidden`, closing
 *    that scroll region off).
 *
 * 2. Diagram containment (the defensive hardening): the four catalog
 *    diagrams, rendered via generate-fixtures.tsx (see that file for why
 *    Playwright can't render the .tsx components directly) against the
 *    app's real compiled CSS, must stay inside a narrow chat column.
 *    NOTE per reviewer's own Chrome check on #1422: this specific 5-stage
 *    payload does not actually overflow with or without the w-full/min-w-0
 *    classes when the diagram is tested in isolation (no ancestor flex
 *    context to trigger the flex `min-width: auto` shrink issue) — I
 *    reproduced the same result. These assertions are still kept as real
 *    containment coverage (Chromium, not Happy DOM), but the decisive
 *    before/after evidence for #1320 is test group 1 above, not this one.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CSS = fs.readFileSync(
  path.resolve(__dirname, "../../../build/client/assets/root-C2cupBm1.css"),
  "utf8",
);

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

test.describe("chat scroll container overflow-x (#1320 root cause)", () => {
  // Same overflow-y-auto/overscroll-contain/scroll-smooth shape as
  // chat-conversation-layout.tsx, with and without the overflow-x-hidden
  // this PR adds, plus a deliberately oversized child (900px) — matching
  // the "an eduai-diagram widget wider than its intended column" scenario
  // the fix commit describes.
  function scrollShapeHtml(withOverflowXHidden: boolean) {
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; }
      #scroll {
        width: ${COLUMN_WIDTH}px;
        height: 200px;
        overflow-y: auto;
        ${withOverflowXHidden ? "overflow-x: hidden;" : ""}
      }
      #wide { width: 900px; height: 100px; background: tomato; }
    </style>
  </head>
  <body><div id="scroll"><div id="wide"></div></div></body>
</html>`;
  }

  test("without overflow-x-hidden, overflow-x computes to auto next to the oversized child (pre-fix)", async ({
    page,
  }) => {
    await page.setContent(scrollShapeHtml(false));
    const { overflowX, hasOverflow } = await page.evaluate(() => {
      const el = document.querySelector("#scroll")!;
      return {
        overflowX: getComputedStyle(el).overflowX,
        hasOverflow: el.scrollWidth > el.clientWidth,
      };
    });
    // The CSS spec quirk the fix commit documents: unset overflow-x next to
    // a non-'visible' overflow-y computes to 'auto', not 'visible' — so the
    // 900px child (real overflow: scrollWidth > clientWidth) becomes
    // reachable only via a sideways scroll gesture nothing in a chat UI
    // prompts the user to make, i.e. off-screen in normal use.
    expect(overflowX).toBe("auto");
    expect(hasOverflow).toBe(true);
  });

  test("with overflow-x-hidden, the oversized child cannot open a horizontal scroll region (post-fix)", async ({
    page,
  }) => {
    await page.setContent(scrollShapeHtml(true));
    const overflowX = await page.evaluate(
      () => getComputedStyle(document.querySelector("#scroll")!).overflowX,
    );
    expect(overflowX).toBe("hidden");
  });
});

test.describe("diagram containment in a narrow chat column", () => {
  /**
   * Assert the rendered diagram markup stays fully inside a narrow column:
   * no page-level horizontal overflow, and the diagram shell itself never
   * extends past the column bounds (a wrapped-but-clipped child would pass
   * an overflow-only check but still be cut off).
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
  }

  for (const name of DIAGRAM_FIXTURE_NAMES) {
    test(`${name} diagram stays within the column`, async ({ page }) => {
      const fixturePath = path.resolve(__dirname, "fixtures", `${name}.html`);
      const html = fs.readFileSync(fixturePath, "utf8");
      await assertContained(page, html);
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
