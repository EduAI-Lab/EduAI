import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

/**
 * #1222 — katex and streamdown CSS must stay off the global stylesheet.
 *
 * app.css is render-blocking on every route, including login and admin. The
 * KaTeX sheet alone is ~18KB of rules plus 59 web fonts that only chat-style
 * surfaces ever need. These assertions fail loudly if the imports drift back.
 */

// Vitest root is apps/core (vitest.config.ts lives there).
const appDir = path.resolve(process.cwd(), "app");
const read = (relative: string) => readFileSync(path.join(appDir, relative), "utf8");

describe("chat markdown CSS scoping (#1222)", () => {
  it("keeps katex and streamdown out of the global stylesheet", () => {
    const appCss = read("app.css");
    const imports = appCss.match(/^@import\s+.*$/gm) ?? [];

    expect(imports.some((line) => line.includes("katex"))).toBe(false);
    expect(imports.some((line) => line.includes("streamdown"))).toBe(false);
  });

  it("keeps the streamdown @source directives in the global stylesheet", () => {
    // Streamdown's markup is styled with Tailwind utilities that must be
    // emitted globally; dropping these silently unstyles every chat surface.
    const appCss = read("app.css");

    expect(appCss).toContain('@source "../../../node_modules/streamdown/dist/index.js";');
    expect(appCss).toContain('@source "../../../node_modules/streamdown/dist/*.js";');
    expect(appCss).toContain('@source "../../../node_modules/@streamdown/code/dist/*.js";');
    expect(appCss).toContain('@source "../../../node_modules/@streamdown/math/dist/*.js";');
  });

  it("holds both vendor sheets in the chunk-scoped stylesheet", () => {
    const chatCss = read("styles/chat-markdown.css");

    expect(chatCss).toContain('@import "katex/dist/katex.min.css";');
    expect(chatCss).toContain('@import "streamdown/styles.css";');
    expect(chatCss).toContain('[data-streamdown="code-block-actions"]');
  });

  it("imports the scoped stylesheet from the shared chat message chunk", () => {
    // ChatMessage is the single node every Core markdown surface renders
    // through — /chat, /admin/chat, /units/:department/chats, and the
    // transcript viewers embedded in the dashboard, course detail and admin
    // user dialogs. Importing anywhere narrower unstyles math on the rest.
    const chatMessage = read("components/chat/chat-message.tsx");

    expect(chatMessage).toContain('import "~/styles/chat-markdown.css";');
  });
});
