/**
 * Static HTML fixtures mirroring the real DOM nesting a course chat message
 * renders inside (#1421 review on #1320). Only layout-relevant classes are
 * included -- color/border-color utilities (bg-muted, text-foreground,
 * border-border/60, etc.) are color tokens defined in packages/ui's @theme
 * and have no effect on the box-model geometry these tests assert on, so
 * they're omitted rather than faked.
 *
 * Investigation note (kept here rather than silently dropped): the
 * AnimatedProcessFlow stage-chip row that motivated this fix does NOT
 * reproduce a real overflow in Chromium at 390px with realistic content --
 * every StageChipButton already sets an explicit `min-w-[4.5rem]` (not
 * `auto`), which disables the "flex item won't shrink below its
 * content's intrinsic width" special case the fix's own commit message
 * describes (that case only applies when min-width computes to `auto`).
 * Verified in a real browser (not asserted from spec-reading) with
 * `[data-testid]` geometry checks: the "before" class lists (`shellClass`/
 * `groupClass`/`rowClass` set to their old values) and the "after" ones
 * produce byte-identical layout for the shipped stage-chip content.
 *
 * The overflow-x-hidden fix on the message scroll container
 * (chat-conversation-layout.tsx) IS independently real and spec-backed
 * (an unset overflow-x next to a non-"visible" overflow-y computes to
 * "auto", not "visible" -- confirmed via getComputedStyle in real
 * Chromium in diagram-viewport.spec.ts) -- `buildScrollFixHtml` isolates
 * and proves that half with a generic oversized element, matching the
 * commit's own framing ("...or any other future content-sizing
 * surprise") rather than a specific diagram type's current content shape.
 */

export type ScrollFixVariant = "before" | "after";

/** chat-conversation-layout.tsx: the message scroll container. */
function scrollContainerClass(variant: ScrollFixVariant): string {
  return variant === "after"
    ? "h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain scroll-smooth"
    : "h-full min-h-0 overflow-y-auto overscroll-contain scroll-smooth";
}

/**
 * Isolates chat-conversation-layout.tsx's overflow-x-hidden addition: a
 * generic 900px-wide block inside the real max-w-3xl message column,
 * standing in for "any future content-sizing surprise" (the commit's own
 * phrase) rather than a specific diagram's current, already-capped chip
 * markup. At a 390px viewport the max-w-3xl column is ~358px wide, so a
 * 900px child is unambiguously wider than its container.
 */
export function buildScrollFixHtml(args: { variant: ScrollFixVariant; css: string }): string {
  const { variant, css } = args;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>${css}</style>
</head>
<body>
  <div class="flex h-full min-h-0 flex-1 flex-col" data-testid="app-shell">
    <div class="flex-1 flex flex-col min-h-0 relative overflow-hidden">
      <div class="${scrollContainerClass(variant)}" data-testid="scroll-container">
        <div class="px-4 md:px-6 py-4 md:py-6">
          <div class="mx-auto w-full max-w-3xl space-y-1" data-testid="message-column">
            <div class="flex gap-3">
              <div class="flex flex-col gap-2 flex-1 min-w-0">
                <div style="width:900px;height:40px" data-testid="oversized-content"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/** Realistic worst case: process-flow's 5-stage cap, real dishwashing-task labels (matches the #1313/#1320 scenario). */
export const PROCESS_FLOW_STAGES = [
  "Scrape food scraps",
  "Rinse under warm water",
  "Apply dish soap and scrub",
  "Rinse off soap thoroughly",
  "Air dry or towel dry",
];

/**
 * The shipped AnimatedProcessFlow markup (current class lists, verbatim
 * from animated-diagram-shell.tsx / animated-process-flow.tsx at HEAD),
 * nested exactly as it renders inside a real course chat message. Proves
 * the actual component -- not a stand-in -- keeps every stage chip
 * visible and un-clipped at a real narrow viewport.
 */
export function buildProcessFlowHtml(css: string): string {
  const chips = PROCESS_FLOW_STAGES.map(
    (label, i) => `
        <li class="flex min-w-0 items-center gap-1.5" data-testid="stage-li">
          ${i > 0 ? `<span class="hidden sm:inline" aria-hidden="true">&rarr;</span>` : ""}
          <button
            type="button"
            class="min-h-11 min-w-[4.5rem] max-w-[7.5rem] flex-1 rounded-lg border px-2 py-2 text-center text-[11px] font-medium leading-snug transition-colors sm:text-xs"
            data-testid="stage-chip"
          >${label}</button>
        </li>`,
  ).join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>${css}</style>
</head>
<body>
  <div class="flex h-full min-h-0 flex-1 flex-col" data-testid="app-shell">
    <div class="flex-1 flex flex-col min-h-0 relative overflow-hidden">
      <div class="h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain scroll-smooth" data-testid="scroll-container">
        <div class="px-4 md:px-6 py-4 md:py-6">
          <div class="mx-auto w-full max-w-3xl space-y-1" data-testid="message-column">
            <div class="flex gap-3">
              <div class="flex flex-col gap-2 flex-1 min-w-0">
                <div class="my-3 w-full min-w-0 max-w-full overflow-hidden rounded-xl border p-3" data-eduai-diagram="process-flow" data-testid="diagram-shell">
                  <div class="mb-2 flex items-center justify-between gap-2">
                    <p class="text-xs font-medium">Process flow</p>
                  </div>
                  <div role="group" aria-label="Interactive process flow" class="min-w-0">
                    <ol class="flex w-full min-w-0 flex-wrap items-stretch justify-center gap-1.5 sm:gap-2" data-testid="stage-row">
                      ${chips}
                    </ol>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
