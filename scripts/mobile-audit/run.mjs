import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { VIEWPORTS, loginToCore, auditPage } from './lib.mjs';
import { APPS } from './pages.mjs';

const OUT_ROOT = path.resolve('../../docs/implementations/screenshots/mobile-audit');
const CORE_URL = APPS.core.baseUrl;
const CREDENTIALS = { email: 'instructor.cs@eduai.local', password: 'EduAI2026!' };

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const results = [];

  try {
    await loginToCore(page, CORE_URL, CREDENTIALS);

    for (const [appKey, appConfig] of Object.entries(APPS)) {
      const outDir = path.join(OUT_ROOT, appKey);
      for (const pageConfig of appConfig.pages) {
        const url = `${appConfig.baseUrl}${pageConfig.path}`;
        for (const viewport of VIEWPORTS) {
          const result = await auditPage(page, {
            app: appKey,
            name: pageConfig.name,
            url,
            viewport,
            outDir,
          });
          results.push(result);
          console.log(`[${appKey}] ${pageConfig.name} @ ${viewport.label}: overflow=${result.overflow} ariaOk=${result.sidebarAriaOk}`);
        }
      }
    }
  } finally {
    fs.mkdirSync(OUT_ROOT, { recursive: true });
    fs.writeFileSync(path.join(OUT_ROOT, 'results.json'), JSON.stringify(results, null, 2));

    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
