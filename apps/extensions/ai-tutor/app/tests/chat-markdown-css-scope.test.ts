import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

/**
 * #1343 / #1342 — AI Tutor renders the same model markdown Core does, and must
 * load the same vendor CSS the same way: streamdown scoped to the chat chunk,
 * KaTeX only when a message actually contains math.
 *
 * Mirrors apps/core/app/tests/unit/chat-markdown-css-scope.test.ts.
 */

// Vitest root is apps/extensions/ai-tutor (vitest.config.ts lives there).
const appDir = path.resolve(process.cwd(), 'app');
const read = (relative: string) => readFileSync(path.join(appDir, relative), 'utf8');

describe('AI Tutor chat markdown CSS scoping', () => {
  it('keeps katex and streamdown out of the global stylesheet', () => {
    const appCss = read('app.css');
    // Leading whitespace is legal CSS, so an indented re-add must fail too.
    const imports = appCss.match(/^[ \t]*@import\s+.*$/gm) ?? [];

    expect(imports.some((line) => line.includes('katex'))).toBe(false);
    expect(imports.some((line) => line.includes('streamdown'))).toBe(false);
  });

  it('keeps the streamdown @source directives in the global stylesheet', () => {
    // Streamdown's markup is styled with Tailwind utilities that must be
    // emitted globally; dropping these silently unstyles every chat surface.
    const appCss = read('app.css');

    expect(appCss).toContain('@source "../node_modules/streamdown/dist/index.js";');
    expect(appCss).toContain('@source "../../../../node_modules/streamdown/dist/*.js";');
    expect(appCss).toContain('@source "../../../../node_modules/@streamdown/code/dist/*.js";');
    expect(appCss).toContain('@source "../../../../node_modules/@streamdown/math/dist/*.js";');
  });

  it('holds the streamdown sheet in the chunk-scoped stylesheet', () => {
    const chatCss = read('styles/chat-markdown.css');

    expect(chatCss).toContain('@import "streamdown/styles.css";');
    expect(chatCss).toContain('[data-streamdown="code-block-actions"]');
  });

  it('imports the scoped stylesheet from the only markdown surface', () => {
    // StudentAiChat is AI Tutor's single `MessageContent markdown` caller.
    const chat = read('components/StudentAiChat.tsx');

    expect(chat).toContain("import '~/styles/chat-markdown.css';");
  });

  it('loads katex on demand rather than statically (#1342)', () => {
    const chatCss = read('styles/chat-markdown.css');
    const imports = chatCss.match(/^[ \t]*@import\s+.*$/gm) ?? [];
    expect(imports.some((line) => line.includes('katex'))).toBe(false);

    const chat = read('components/StudentAiChat.tsx');
    expect(chat).toContain("loadKatexStyles: () => import('katex/dist/katex.min.css')");
  });

  it('normalizes assistant markdown before rendering it (#1401)', () => {
    // Without this, model LaTeX reaches KaTeX in delimiters remark-math does
    // not accept and renders as literal text — and the #1342 gate, which reads
    // the normalized body, would never fire.
    const chat = read('components/StudentAiChat.tsx');

    expect(chat).toContain("import { normalizeMathMarkdown } from '@eduai/ui/math-markdown';");
    expect(chat).toContain('{normalizeMathMarkdown(msg.content)}');
  });
});
