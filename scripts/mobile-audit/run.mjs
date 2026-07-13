/**
 * Mobile responsiveness audit (#805): screenshots every configured page in
 * Core, AI Tutor, and Question Maker at each viewport in VIEWPORTS, and
 * flags horizontal overflow / missing sidebar aria attributes.
 *
 * Requires: Core, AI Tutor, and Question Maker dev servers running locally
 * (see each app's README for `npm run dev`), plus a seeded instructor
 * account matching CREDENTIALS below (the default matches the seed data
 * from `apps/core`'s `npm run db:seed`).
 *
 * Auth: logs into Core once (loginToCore); AI Tutor and Question Maker are
 * never separately logged into — see the isAuthenticatedNavigation() doc
 * comment in lib.mjs for why a single Core login is expected to cover all
 * three apps in local dev, and how a broken assumption is caught (each
 * result's `authOk` flag; the run exits non-zero if any page was actually
 * bounced to a login screen instead of the target page).
 *
 * Optional env overrides:
 *   CORE_URL              default http://localhost:3000
 *   AI_TUTOR_URL          default http://localhost:3001
 *   QM_URL                default http://localhost:5180
 *   AUDIT_EMAIL           default instructor.cs@eduai.local
 *   AUDIT_PASSWORD        default EduAI2026!
 *   MOBILE_AUDIT_OUT_DIR  default docs/implementations/screenshots/mobile-audit
 *
 * Usage:
 *   cd scripts/mobile-audit && npm install && node run.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { VIEWPORTS, loginToCore, auditPage } from './lib.mjs';
import { APPS } from './pages.mjs';

const OUT_ROOT =
  process.env.MOBILE_AUDIT_OUT_DIR || path.resolve('../../docs/implementations/screenshots/mobile-audit');
const CORE_URL = APPS.core.baseUrl;
const CREDENTIALS = {
  email: process.env.AUDIT_EMAIL || 'instructor.cs@eduai.local',
  password: process.env.AUDIT_PASSWORD || 'EduAI2026!',
};

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
          const authFlag = result.authOk ? '' : ' AUTH-FAILED (bounced to a login page — see finalUrl)';
          console.log(`[${appKey}] ${pageConfig.name} @ ${viewport.label}: overflow=${result.overflow} ariaOk=${result.sidebarAriaOk}${authFlag}`);
        }
      }
    }
  } finally {
    try {
      fs.mkdirSync(OUT_ROOT, { recursive: true });
      fs.writeFileSync(path.join(OUT_ROOT, 'results.json'), JSON.stringify(results, null, 2));
    } finally {
      await browser.close();
    }
  }

  const unauthenticated = results.filter((r) => !r.authOk);
  if (unauthenticated.length > 0) {
    console.error(
      `\n${unauthenticated.length} page(s) were not actually authenticated when audited (see AUTH-FAILED above) — their screenshots show a login page, not the target page. This means the single Core login no longer covers every app; see the auth-story comment on isAuthenticatedNavigation() in lib.mjs.`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
