import { compile } from "@tailwindcss/node";

/**
 * Compiles real Tailwind v4 utility CSS for the given class-name candidates
 * using the same engine (`@tailwindcss/node`) the project's own
 * `@tailwindcss/vite` build uses, rather than hand-transcribing CSS rules
 * that could silently drift from what Tailwind actually generates (#1421
 * review on #1320 -- a Happy DOM classname assertion doesn't prove the real
 * browser box model these classes produce).
 *
 * Uses the bare default theme (`@import "tailwindcss"`), not the project's
 * `app.css`. The only project-level `@theme` override is `--font-sans`
 * (packages/ui/src/styles/base.css) plus semantic color tokens -- none of
 * which affect the box-model geometry (width/min-width/max-width/flex/gap/
 * overflow) these tests assert on, so the default spacing/container scale
 * Tailwind ships with is what apps/core actually renders with here.
 */
export async function buildTailwindCss(candidates: string[]): Promise<string> {
  const { build } = await compile('@import "tailwindcss";', {
    base: import.meta.dirname,
    onDependency: () => {},
  });
  return build(candidates);
}
