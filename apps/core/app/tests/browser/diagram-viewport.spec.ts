import { test, expect, type Page } from "@playwright/test";
import { buildTailwindCss } from "./support/build-tailwind-css";
import {
  buildProcessFlowHtml,
  buildScrollFixHtml,
  PROCESS_FLOW_STAGES,
  type ScrollFixVariant,
} from "./support/diagram-fixture";

/**
 * Real-Chromium proof of the #1320 viewport-containment fix, replacing a
 * Happy DOM classname assertion that can't compute layout (#1421 review:
 * "This test only checks class-name strings in Happy DOM, so it cannot
 * prove the viewport behavior... Please add a Playwright test or captured
 * before/after repro that fails on the base, passes here, and checks for
 * both overflow and clipped content").
 *
 * Two things are tested separately because they turned out to have
 * different levels of provable necessity in a real browser (see
 * support/diagram-fixture.ts for the investigation notes):
 *
 *  - The scroll-container overflow-x-hidden fix (chat-conversation-layout.tsx)
 *    is spec-backed and genuinely reproducible: an unset overflow-x next to
 *    a non-"visible" overflow-y computes to "auto", not "visible". Proven
 *    below with the exact "before"/"after" class lists from
 *    2655cfcb3^/HEAD on a generic oversized child, matching the commit's
 *    own framing ("...or any other future content-sizing surprise").
 *
 *  - The shipped AnimatedProcessFlow markup (current HEAD classes) is
 *    checked directly against the real content it renders: every stage
 *    chip stays visible, un-clipped, and inside the message column at a
 *    real narrow viewport (390px, matching Saad's Week 13 pilot report).
 */

const VIEWPORT = { width: 390, height: 844 };

const CANDIDATE_CLASSES = [
  "flex", "flex-col", "flex-1", "min-h-0", "min-w-0", "gap-3", "gap-2", "gap-1.5",
  "w-full", "max-w-full", "max-w-3xl", "mx-auto", "space-y-1",
  "overflow-hidden", "overflow-y-auto", "overflow-x-hidden", "overscroll-contain", "scroll-smooth",
  "px-2", "px-4", "py-2", "py-3", "py-4", "my-3", "mb-2",
  "md:px-6", "md:py-6", "sm:gap-2", "sm:text-xs", "sm:inline",
  "relative", "rounded-xl", "rounded-lg", "border",
  "flex-wrap", "items-stretch", "items-center", "justify-between", "justify-center",
  "min-h-11", "min-w-[4.5rem]", "max-w-[7.5rem]",
  "text-center", "text-xs", "text-[11px]", "font-medium", "leading-snug", "transition-colors",
  "hidden",
];

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="scroll-container"]') as HTMLElement;
    return el.scrollWidth > el.clientWidth;
  });
}

/** getComputedStyle's resolved overflow-x, the direct proof of the commit's claimed spec mechanism. */
async function computedOverflowX(page: Page): Promise<string> {
  return page.evaluate(
    () => getComputedStyle(document.querySelector('[data-testid="scroll-container"]')!).overflowX,
  );
}

test.describe("message scroll container overflow-x fix (#1320)", () => {
  let css: string;

  test.beforeAll(async () => {
    css = await buildTailwindCss(CANDIDATE_CLASSES);
  });

  async function load(page: Page, variant: ScrollFixVariant) {
    await page.setViewportSize(VIEWPORT);
    await page.setContent(buildScrollFixHtml({ variant, css }));
  }

  test("reproduces the pre-fix implicit auto -- a silent horizontal scroll region -- on unpatched markup", async ({ page }) => {
    await load(page, "before");
    // Direct, real-browser proof of the exact spec mechanism the commit
    // describes: with only overflow-y set in the source, the unset
    // overflow-x does NOT stay "visible" -- Chromium resolves it to
    // "auto", not the "visible" a naive reading of the class list
    // ("overflow-y-auto" alone) would suggest. Happy DOM has no layout
    // engine and can't resolve this cascade at all.
    expect(await computedOverflowX(page)).toBe("auto");
    expect(await hasHorizontalOverflow(page)).toBe(true);
  });

  test("overflow-x-hidden replaces the implicit auto after the fix", async ({ page }) => {
    await load(page, "after");
    expect(await computedOverflowX(page)).toBe("hidden");
  });
});

test.describe("AnimatedProcessFlow stays inside the viewport (#1320, #1421)", () => {
  test("every stage chip is visible and un-clipped at a narrow viewport", async ({ page }) => {
    const css = await buildTailwindCss(CANDIDATE_CLASSES);
    await page.setViewportSize(VIEWPORT);
    await page.setContent(buildProcessFlowHtml(css));

    expect(await hasHorizontalOverflow(page)).toBe(false);

    const result = await page.evaluate(() => {
      const column = document.querySelector('[data-testid="message-column"]')!.getBoundingClientRect();
      const chips = Array.from(document.querySelectorAll('[data-testid="stage-chip"]'));
      const clipped = chips.filter((chip) => {
        const r = chip.getBoundingClientRect();
        // A chip counts as clipped if it has no rendered area (collapsed
        // by an ancestor's overflow:hidden) or its box extends past the
        // message column's right edge.
        return r.width === 0 || r.height === 0 || r.right > column.right + 0.5;
      });
      return {
        clippedCount: clipped.length,
        labels: chips.map((c) => c.textContent ?? ""),
      };
    });

    expect(result.clippedCount).toBe(0);
    // Not just "nothing overflows" -- every stage chip is actually there
    // and legible, i.e. wrapped onto new lines rather than silently
    // clipped by the scroll container's overflow-x-hidden.
    expect(result.labels).toEqual(PROCESS_FLOW_STAGES);
  });
});
