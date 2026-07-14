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
 * Auth: pages with `requiresAuth: false` in pages.mjs are audited in a fresh
 * logged-out browser context so sign-in screens are captured as-is. All other
 * pages share one context that logs into Core first; AI Tutor and Question
 * Maker are never separately logged into — see the isAuthenticatedNavigation()
 * doc comment in lib.mjs for why a single Core login is expected to cover
 * those apps in local dev, and how a broken assumption is caught (each
 * result's `authOk` flag; the run exits non-zero if navigation did not land
 * on the expected page).
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

function collectAudits() {
  const publicAudits = [];
  const authAudits = [];

  for (const [appKey, appConfig] of Object.entries(APPS)) {
    for (const pageConfig of appConfig.pages) {
      const entry = { appKey, appConfig, pageConfig };
      if (pageConfig.requiresAuth === false) {
        publicAudits.push(entry);
      } else {
        authAudits.push(entry);
      }
    }
  }

  return { publicAudits, authAudits };
}

async function auditEntries(browser, entries, { requiresAuth, login }) {
  const results = [];
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    if (login) {
      await loginToCore(page, CORE_URL, CREDENTIALS);
    }

    for (const { appKey, appConfig, pageConfig } of entries) {
      const url = `${appConfig.baseUrl}${pageConfig.path}`;
      const outDir = path.join(OUT_ROOT, appKey);

      for (const viewport of VIEWPORTS) {
        const result = await auditPage(page, {
          app: appKey,
          name: pageConfig.name,
          url,
          viewport,
          outDir,
          requiresAuth,
        });
        results.push(result);

        const failLabel = requiresAuth
          ? ' AUTH-FAILED (bounced to a login page — see finalUrl)'
          : ' PUBLIC-PAGE-FAILED (did not stay on the requested page — see finalUrl)';
        const navFlag = result.authOk ? '' : failLabel;
        console.log(
          `[${appKey}] ${pageConfig.name} @ ${viewport.label}: overflow=${result.overflow} ariaOk=${result.sidebarAriaOk}${navFlag}`,
        );
      }
    }
  } finally {
    await context.close();
  }

  return results;
}

async function main() {
  const browser = await chromium.launch();
  const { publicAudits, authAudits } = collectAudits();
  const results = [];

  try {
    if (publicAudits.length > 0) {
      results.push(...(await auditEntries(browser, publicAudits, { requiresAuth: false, login: false })));
    }
    if (authAudits.length > 0) {
      results.push(...(await auditEntries(browser, authAudits, { requiresAuth: true, login: true })));
    }
  } finally {
    try {
      fs.mkdirSync(OUT_ROOT, { recursive: true });
      fs.writeFileSync(path.join(OUT_ROOT, 'results.json'), JSON.stringify(results, null, 2));
    } finally {
      await browser.close();
    }
  }

  const failed = results.filter((r) => !r.authOk);
  if (failed.length > 0) {
    console.error(
      `\n${failed.length} page(s) did not land on the expected page when audited (see AUTH-FAILED / PUBLIC-PAGE-FAILED above). Check results.json for finalUrl values.`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
