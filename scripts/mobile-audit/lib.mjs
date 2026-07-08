import fs from 'node:fs';
import path from 'node:path';

export const VIEWPORTS = [
  { label: '375x667', width: 375, height: 667 },
  { label: '700x900', width: 700, height: 900 },
];

export async function loginToCore(page, coreUrl, { email, password }) {
  await page.goto(`${coreUrl}/auth/login`);
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/login'), { timeout: 15000 });
}

export async function auditPage(page, { app, name, url, viewport, outDir }) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(url, { waitUntil: 'networkidle' });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );

  const sidebarAriaOk = await page.evaluate(() => {
    const trigger = document.querySelector('[data-slot="sidebar-trigger"]');
    if (!trigger) return null;
    return trigger.hasAttribute('aria-expanded') && trigger.hasAttribute('aria-controls');
  });

  fs.mkdirSync(outDir, { recursive: true });
  const screenshotPath = path.join(outDir, `${name}-${viewport.label}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  return {
    app,
    name,
    viewport: viewport.label,
    url,
    overflow,
    sidebarAriaOk,
    screenshotPath,
  };
}
