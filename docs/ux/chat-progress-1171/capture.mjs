/**
 * Capture visual QA screenshots for #1171 chat progress gallery.
 * Usage: node docs/ux/chat-progress-1171/capture.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, "qa-gallery.html");
const fileUrl = `file://${htmlPath}`;

const shots = [
  ["cap-routing", "01-routing.png"],
  ["cap-waiting", "02-waiting-for-model.png"],
  ["cap-searching", "03-searching-materials.png"],
  ["cap-assist", "04-working-on-assist-reply.png"],
  ["cap-streaming", "05-streaming-tokens-no-status.png"],
  ["cap-compact-search", "06-compact-searching-after-text.png"],
  ["cap-compact-generating", "07-compact-generating-post-tool.png"],
  ["cap-longer", "08-taking-longer-than-usual.png"],
];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 900, height: 1200 },
  deviceScaleFactor: 2,
});
await page.goto(fileUrl, { waitUntil: "networkidle" });

for (const [id, file] of shots) {
  const el = page.locator(`#${id}`);
  await el.screenshot({ path: path.join(__dirname, file) });
  console.log("wrote", file);
}

await page.screenshot({
  path: path.join(__dirname, "00-gallery-overview.png"),
  fullPage: true,
});
console.log("wrote 00-gallery-overview.png");

await browser.close();
