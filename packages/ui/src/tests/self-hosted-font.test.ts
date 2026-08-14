import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

/**
 * #1221 — Outfit must stay self-hosted.
 *
 * The Google Fonts chain this replaced was copied into all three apps, so a
 * merge that resurrects any one of the deleted `<link>` blocks puts the
 * render-blocking third-party handshake back on that app alone — silently,
 * because everything still renders. These assertions fail loudly instead.
 *
 * They also pin the two halves of the contract that must move together: the
 * `@import` that ships the font files, and the family name `--font-sans`
 * resolves to. Fontsource registers the variable file as "Outfit Variable",
 * which is not interchangeable with "Outfit" — dropping the word `Variable`
 * leaves every declaration valid CSS that falls through to the system sans.
 */

// Vitest root is packages/ui (vitest.config.ts lives there).
const repoRoot = path.resolve(process.cwd(), '../..');
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), 'utf8');

const APP_DOCUMENT_HEADS = [
  'apps/core/app/root.tsx',
  'apps/extensions/ai-tutor/app/root.tsx',
  'apps/extensions/question-maker/app/frontend/index.html',
];

describe('self-hosted Outfit (#1221)', () => {
  it('ships the font from the same file that declares --font-sans', () => {
    const baseCss = read('packages/ui/src/styles/base.css');
    // Leading whitespace is legal CSS, so an indented re-add must match too.
    const imports = baseCss.match(/^[ \t]*@import\s+.*$/gm) ?? [];

    expect(imports.some((line) => line.includes('@fontsource-variable/outfit'))).toBe(true);
  });

  it('names the variable family in every --font-sans declaration', () => {
    const baseCss = read('packages/ui/src/styles/base.css');
    const declarations = baseCss.match(/^[ \t]*--font-sans:.*$/gm) ?? [];

    // Three: the @theme token, the @theme inline bridge, and the token block.
    expect(declarations).toHaveLength(3);
    for (const declaration of declarations) {
      expect(declaration).toContain('"Outfit Variable"');
    }
  });

  it.each(APP_DOCUMENT_HEADS)('keeps Google Fonts out of %s', (relative) => {
    const source = read(relative);

    expect(source).not.toContain('fonts.googleapis.com');
    expect(source).not.toContain('fonts.gstatic.com');
  });
});
