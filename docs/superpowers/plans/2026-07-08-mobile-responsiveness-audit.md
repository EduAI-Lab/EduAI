# Mobile Responsiveness Audit (#805) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce `docs/implementations/mobile-responsiveness-audit.md` — a screenshot-backed, severity-ranked audit of mobile-width (375×667 and 700×900) behavior across Core, AI Tutor, and Question Maker — using a small standalone Playwright script, without touching any app code.

**Architecture:** A standalone Node/Playwright script (`scripts/mobile-audit/`) logs into Core once (shared session cookie works across all three localhost apps because cookies are domain-scoped, not port-scoped), then walks a declarative list of pages per app at two viewports, capturing a screenshot and two objective checks (horizontal overflow, sidebar-trigger ARIA attributes) per page. Results are written to JSON; a final task reviews the screenshots/JSON and hand-writes the markdown report with severity judgments per the spec's P0/P1/P2 rubric.

**Tech Stack:** Node.js (ESM `.mjs`), Playwright (`chromium`), no test framework needed — this produces a docs artifact, not app code.

## Global Constraints

- Do not add `playwright` as a dependency of any app under `apps/`. It lives in its own `scripts/mobile-audit/package.json`.
- Do not modify any application code in this plan — audit only, per the approved spec (`docs/superpowers/specs/2026-07-08-mobile-responsiveness-audit-design.md`).
- Seed credentials: `instructor.cs@eduai.local` / `student1@eduai.local`, password `EduAI2026!` (from `apps/core/prisma/seed.ts`).
- Viewports: 375×667 (phone), 700×900 (small tablet, still under the shared 800px `useIsMobile` breakpoint in `packages/ui/src/hooks/use-mobile.ts`).
- Core login form selectors: `#email`, `#password`, submit button text `Sign in` (`apps/core/app/components/login-form.tsx`).
- AI Tutor and QM both redirect unauthenticated users to `{coreUrl}/login?redirect=...` (`apps/extensions/ai-tutor/app/routes/home.tsx:29-31`, `apps/extensions/question-maker/app/frontend/src/components/auth/QmAppGate.tsx:17-19`) — logging into Core first is sufficient for all three.
- Sidebar mobile trigger selector: `[data-slot="sidebar-trigger"]` (`packages/ui/src/ui/sidebar.tsx:256-268`) — currently has no `aria-expanded`/`aria-controls`, which the audit should flag as a finding, not treat as a script bug.

---

### Task 1: Shared audit library and page config

**Files:**
- Create: `scripts/mobile-audit/package.json`
- Create: `scripts/mobile-audit/lib.mjs`
- Create: `scripts/mobile-audit/pages.mjs`

**Interfaces:**
- Produces: `lib.mjs` exports `VIEWPORTS` (array of `{label, width, height}`), `loginToCore(page, coreUrl, {email, password})` (async, resolves once redirected off `/auth/login`), `auditPage(page, {app, name, url, viewport, outDir})` → `Promise<{app, name, viewport: string, url, overflow: boolean, sidebarAriaOk: boolean|null, screenshotPath: string}>`.
- Produces: `pages.mjs` exports `APPS`, shaped as:
  ```js
  export const APPS = {
    core: {
      baseUrl: 'http://localhost:3000',
      pages: [
        { name: 'sign-in', path: '/auth/login', requiresAuth: false },
        { name: 'home', path: '/home', requiresAuth: true },
        { name: 'dashboard', path: '/dashboard', requiresAuth: true },
        { name: 'courses', path: '/courses', requiresAuth: true },
        { name: 'chat', path: '/chat', requiresAuth: true },
        { name: 'settings', path: '/settings', requiresAuth: true },
        { name: 'admin-users', path: '/admin/users', requiresAuth: true },
      ],
    },
    aiTutor: {
      baseUrl: 'http://localhost:3001',
      pages: [
        { name: 'home', path: '/home', requiresAuth: true },
        { name: 'student-list', path: '/student', requiresAuth: true },
        { name: 'instructor-list', path: '/instructor', requiresAuth: true },
        { name: 'settings', path: '/settings', requiresAuth: true },
      ],
    },
    questionMaker: {
      baseUrl: 'http://localhost:5173',
      pages: [
        { name: 'course-selection', path: '/', requiresAuth: true },
        { name: 'dashboard', path: '/dashboard', requiresAuth: true },
        { name: 'question-bank', path: '/question-bank', requiresAuth: true },
        { name: 'settings', path: '/settings', requiresAuth: true },
      ],
    },
  };
  ```
  (Task 2 will confirm/correct exact QM and AI Tutor route paths against the running dev servers before the full run — see Task 2 step 1.)

- [ ] **Step 1: Create the audit tool's own package.json**

```json
{
  "name": "mobile-audit",
  "private": true,
  "type": "module",
  "dependencies": {
    "playwright": "^1.61.1"
  }
}
```

Write this to `scripts/mobile-audit/package.json`.

- [ ] **Step 2: Install the dependency**

Run: `cd scripts/mobile-audit && npm install`
Expected: `node_modules/playwright` created, no errors.

- [ ] **Step 3: Write `lib.mjs`**

```js
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
```

- [ ] **Step 4: Write `pages.mjs`**

Write the `APPS` object shown in the Interfaces section above to `scripts/mobile-audit/pages.mjs`, exported as `export const APPS = { ... };`.

- [ ] **Step 5: Smoke-test `lib.mjs` in isolation**

Run:
```bash
cd scripts/mobile-audit
node -e "
import('./lib.mjs').then(({ VIEWPORTS, loginToCore, auditPage }) => {
  console.log(typeof loginToCore === 'function', typeof auditPage === 'function', VIEWPORTS.length === 2);
});
"
```
Expected output: `true true true`

- [ ] **Step 6: Commit**

```bash
git add scripts/mobile-audit/package.json scripts/mobile-audit/lib.mjs scripts/mobile-audit/pages.mjs
git commit -m "chore(mobile-audit): add Playwright audit script scaffolding"
```

---

### Task 2: Runner script

**Files:**
- Create: `scripts/mobile-audit/run.mjs`

**Interfaces:**
- Consumes: `VIEWPORTS`, `loginToCore`, `auditPage` from `./lib.mjs`; `APPS` from `./pages.mjs`.
- Produces: `docs/implementations/screenshots/mobile-audit/<app>/*.png` and `docs/implementations/screenshots/mobile-audit/results.json` (array of the objects `auditPage` returns, tagged with `app`).

- [ ] **Step 1: Confirm real route paths before wiring the runner**

Before writing `run.mjs`, verify the `path` values in `pages.mjs` against the actual route files, since AI Tutor/QM route paths were inferred from filenames, not confirmed at runtime:
- `apps/extensions/ai-tutor/app/routes/student.tsx` / `student.list.tsx` / `instructor.tsx` / `instructor.list.tsx` / `settings.tsx` — check the `path` exported in `apps/extensions/ai-tutor/app/routes.ts` (or equivalent route config) for the actual URL segments.
- `apps/extensions/question-maker/app/frontend/src/App.tsx` — check the `<Route path="...">` entries for `DashboardPage`, `QuestionBankPage`, `SettingsPage`.

Update `pages.mjs` paths to match. This step has no fixed code because it depends on what the route config actually says — read the two files above and correct any mismatches inline.

- [ ] **Step 2: Write `run.mjs`**

```js
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

  await loginToCore(page, CORE_URL, CREDENTIALS);

  const results = [];

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

  fs.mkdirSync(OUT_ROOT, { recursive: true });
  fs.writeFileSync(path.join(OUT_ROOT, 'results.json'), JSON.stringify(results, null, 2));

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Commit**

```bash
git add scripts/mobile-audit/run.mjs
git commit -m "chore(mobile-audit): add audit runner script"
```

(Running it requires all three dev servers up — done in Task 3, since that's where failures surface.)

---

### Task 3: Start the dev environment and execute the audit

**Files:** none created — this task runs infrastructure and the Task 2 script.

- [ ] **Step 1: Start the Docker dev databases**

Run: `npm run docker:dev:db` (from repo root)
Expected: containers for Core, AI Tutor, and QM Postgres instances report healthy/started.

- [ ] **Step 2: Start Core**

Run in background: `npx turbo run dev --filter=edu-ai`
Poll until ready: `until curl -sf http://localhost:3000 >/dev/null; do sleep 1; done` (30s timeout)

- [ ] **Step 3: Start AI Tutor (frontend + server)**

Run in background: `npx turbo run dev --filter=ai-tutor --filter=ai-tutor-server`
Poll: `until curl -sf http://localhost:3001 >/dev/null; do sleep 1; done` and `until curl -sf http://localhost:4000 >/dev/null; do sleep 1; done`

- [ ] **Step 4: Start Question Maker (frontend + backend)**

Run in background: `npx turbo run dev --filter='question-maker-*'`
Poll: `until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done` and `until curl -sf http://localhost:8000 >/dev/null; do sleep 1; done`

- [ ] **Step 5: Run the audit script**

Run: `cd scripts/mobile-audit && node run.mjs`
Expected: one log line per (app, page, viewport) combination, script exits 0, and `docs/implementations/screenshots/mobile-audit/results.json` plus per-app screenshot directories are populated (spot-check file counts: `pages × viewports` per app).

- [ ] **Step 6: If any page fails to load or login fails**

Debug via the printed Playwright error (page URL, selector timeout) — common causes are a wrong `path` in `pages.mjs` (fix per Task 2 Step 1) or a dev server not actually ready (re-check Step 2-4 polling). Re-run Step 5 after fixing.

- [ ] **Step 7: Tear down dev servers**

Stop each backgrounded `turbo run dev` process (`kill` the PID or `pkill -f 'turbo run dev'`). Leave `npm run docker:dev:db` running only if other work needs it; otherwise `npm run docker:dev:db:down`.

- [ ] **Step 8: Commit the raw audit output**

```bash
git add docs/implementations/screenshots/mobile-audit
git commit -m "chore(mobile-audit): add raw screenshots and results from audit run"
```

---

### Task 4: Write the audit report

**Files:**
- Create: `docs/implementations/mobile-responsiveness-audit.md`

- [ ] **Step 1: Review every screenshot and results.json entry**

For each entry in `docs/implementations/screenshots/mobile-audit/results.json`, open the corresponding screenshot and judge severity using the spec's rubric:
- **P0** — unusable/blocking (content unreachable, action can't be performed, page broken).
- **P1** — degraded but usable (cramped, awkward, but the task can be completed).
- **P2** — cosmetic (spacing, minor visual issues, no functional impact).

Cross-reference `overflow: true` and `sidebarAriaOk: false` results — those are objective findings that should appear in the report even if visually subtle.

- [ ] **Step 2: Write the report**

Structure `docs/implementations/mobile-responsiveness-audit.md` as:

```markdown
# Mobile Responsiveness Audit (#805)

Audited at 375×667 and 700×900 against the shared 800px `useIsMobile` breakpoint.
Screenshots: `docs/implementations/screenshots/mobile-audit/<app>/`.

## Core

| Page | Viewport | Overflow | Sidebar ARIA | Severity | Notes |
|------|----------|----------|--------------|----------|-------|
| sign-in | 375x667 | ... | ... | ... | ... |
<!-- one row per core page × viewport -->

## AI Tutor

| Page | Viewport | Overflow | Sidebar ARIA | Severity | Notes |
|------|----------|----------|--------------|----------|-------|
<!-- ... -->

## Question Maker

| Page | Viewport | Overflow | Sidebar ARIA | Severity | Notes |
|------|----------|----------|--------------|----------|-------|
<!-- ... -->

## Punch list (P0/P1, grouped by app)

### Core
- [ ] ...

### AI Tutor
- [ ] ...

### Question Maker
- [ ] ...
```

Fill every table row from the actual `results.json` data and your Step 1 screenshot review — no placeholder rows.

- [ ] **Step 3: Commit**

```bash
git add docs/implementations/mobile-responsiveness-audit.md
git commit -m "docs: add mobile responsiveness audit report (#805)"
```

---

### Task 5: Update TESTS.md cross-reference (if applicable)

**Files:**
- Modify: `TESTS.md` (repo root) — only if it tracks non-test documentation artifacts; otherwise skip.

- [ ] **Step 1: Check whether TESTS.md is scoped to test suites only**

Read `TESTS.md`. If it's exclusively an inventory of automated test files (per `CLAUDE.md`: "canonical test inventory"), this audit script/report doesn't belong there — skip this task entirely and do not modify the file.

- [ ] **Step 2: Skip commit**

No commit for this task; it exists only to make the "don't forget TESTS.md" convention from `CLAUDE.md` an explicit decision point, not an oversight.
