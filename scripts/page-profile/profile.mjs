/**
 * Headless page profiler — per-page web vitals + JS chunk breakdown, no manual
 * DevTools work. Drives a real Chromium via Playwright, loads every UI route in
 * ./pages.mjs across Core, AI Tutor and Question Maker, and reports
 * TTFB / FCP / LCP / DCL / load / CLS / main-thread blocking plus every JS chunk
 * the page pulled.
 *
 * Coverage: ./pages.mjs is the exhaustive route inventory (derived from each
 * app's route manifest, `/api/*` excluded). Each route declares the LOWEST
 * seeded role that can render it; this script logs in once per role that is
 * actually needed and profiles each page under the right session, so admin and
 * unit-admin pages are measured as themselves rather than as a login bounce.
 * Routes with dynamic segments get real ids from ./resolvers.mjs — unresolvable
 * ones are reported SKIPPED, never measured against a 404.
 *
 * One Core login authenticates all three apps: the Better Auth dev cookie is
 * host-only on localhost and cookies ignore port (RFC 6265) — see the
 * isAuthenticatedNavigation() comment in ../mobile-audit/lib.mjs. Each result
 * carries `authOk`, so a broken assumption shows up as REDIRECTED instead of
 * silently profiling a login screen.
 *
 * Each run of a page uses a FRESH browser context (cold cache, clean storage,
 * session restored from that role's storageState) so runs are comparable and
 * the login navigation is never inside the measurement. Pass --warm to keep the
 * HTTP cache instead (measures repeat visits).
 *
 * Usage:
 *   cd scripts/page-profile && npm install && npx playwright install chromium
 *   node profile.mjs                                # everything, 3 runs each
 *   node profile.mjs --app=core                     # one app
 *   node profile.mjs --app=core --role=admin        # one role
 *   node profile.mjs --page=dashboard-student,chat-thread
 *   node profile.mjs --runs=5 --cpu=4 --net=fast3g  # throttled
 *   node profile.mjs --chunks --out=docs/perf/frontend/baseline --target=dev-remote
 *
 * Flags:
 *   --app=<key[,key]>   core | aiTutor | questionMaker      (default: all)
 *   --page=<name[,..]>  page names from pages.mjs           (default: all)
 *   --role=<r[,r]>      anon | student | instructor | unitAdmin | admin
 *   --runs=N            iterations per page, median reported (default 3)
 *   --warm              reuse HTTP cache between runs        (default: cold)
 *   --cpu=N             CPU throttle multiplier, e.g. 4      (default: off)
 *   --net=<profile>     fast3g | slow3g | off                (default: off)
 *   --chunks            print per-chunk JS table per page
 *   --full-chunks       also write page-chunks.json with untruncated chunk lists
 *   --pace=N            ms idled between loads, keeps Core's auth limiter happy
 *                       (default 750; 0 disables)
 *   --out=<dir>         output dir (default docs/perf/frontend/baseline)
 *   --target=<label>    fingerprint label, e.g. dev-remote   (default local)
 *   --headed            show the browser
 *
 * Output (same shape as `npm run perf:endpoints`, so both baselines are read the
 * same way): <out>/page-vitals.json with every measurement — per-page JS totals
 * in full, but only the CHUNK_LIMIT heaviest chunks each (see trimChunks; pass
 * --full-chunks for the rest) — plus <out>/errors.log
 * and <out>/errors.json listing every page that did NOT produce a trustworthy
 * number — load failure, login bounce, unresolved dynamic id, or a role whose
 * login never succeeded. A failed login degrades that role's pages to errors
 * instead of aborting the run, so one broken session still yields a full report
 * of what to fix.
 *
 * Env: CORE_URL, AI_TUTOR_URL, QM_URL (page origins), AI_TUTOR_API_URL,
 *      QM_API_URL (id resolution), SEED_PASSWORD (overrides every account),
 *      TARGET_LABEL (same as --target).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { chromium, request as apiRequest } from 'playwright';
import { loginToCore } from '../mobile-audit/lib.mjs';
import { APPS, ACCOUNTS } from './pages.mjs';
import { resolveParams, fillPath } from './resolvers.mjs';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.slice(name.length + 3) : true;
};
const list = (name) => {
  const v = flag(name);
  return typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
};

const RUNS = Number(flag('runs') ?? 3);
const COLD = !flag('warm');
const CPU_THROTTLE = Number(flag('cpu') ?? 0);
const NET_PROFILE = typeof flag('net') === 'string' ? flag('net') : 'off';
const SHOW_CHUNKS = Boolean(flag('chunks'));
const FULL_CHUNKS = Boolean(flag('full-chunks'));
// Core's Better Auth limiter allows 100 requests per 60s per IP, and every
// measured load costs it a few (session read on each app). An unpaced sweep of
// ~50 pages x 3 runs sails past that and starts getting bounced to the login
// page mid-run, which looks like a broken page rather than a throttled one.
// Idle between loads so a full sweep stays under the limit by construction.
const PACE_MS = Number(flag('pace') ?? 750);
const RATE_LIMIT_HINT = /too many requests|rate ?limit|\b429\b/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT_DIR = (typeof flag('out') === 'string' ? flag('out') : 'docs/perf/frontend/baseline').replace(/\/$/, '');
const TARGET_LABEL = (typeof flag('target') === 'string' ? flag('target') : process.env.TARGET_LABEL) ?? 'local';
const HEADED = Boolean(flag('headed'));
const APP_FILTER = list('app');
const PAGE_FILTER = list('page');
const ROLE_FILTER = list('role');

// Chrome DevTools' own presets, in bytes/sec and ms.
const NET_PROFILES = {
  off: null,
  fast3g: { downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 },
  slow3g: { downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8, latency: 400 },
};
if (!(NET_PROFILE in NET_PROFILES)) {
  console.error(`unknown --net=${NET_PROFILE}; expected ${Object.keys(NET_PROFILES).join(' | ')}`);
  process.exit(2);
}

const credentialsFor = (role) => {
  const acct = ACCOUNTS[role];
  if (!acct) return null;
  return process.env.SEED_PASSWORD ? { ...acct, password: process.env.SEED_PASSWORD } : acct;
};

// ---------------------------------------------------------------------------
// In-page collectors. Injected BEFORE any document script runs so the
// PerformanceObservers exist before the browser emits LCP / CLS / long tasks.
// ---------------------------------------------------------------------------
function installCollectors() {
  window.__vitals = { lcp: 0, cls: 0, longTasks: 0, longTaskTime: 0 };
  const obs = (type, cb) => {
    try {
      new PerformanceObserver(cb).observe({ type, buffered: true });
    } catch {
      /* unsupported entry type in this browser — leave the metric at 0 */
    }
  };
  obs('largest-contentful-paint', (l) => {
    for (const e of l.getEntries()) window.__vitals.lcp = e.startTime;
  });
  obs('layout-shift', (l) => {
    for (const e of l.getEntries()) if (!e.hadRecentInput) window.__vitals.cls += e.value;
  });
  obs('longtask', (l) => {
    for (const e of l.getEntries()) {
      window.__vitals.longTasks += 1;
      window.__vitals.longTaskTime += e.duration;
    }
  });
}

function readMetrics() {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  const resources = performance.getEntriesByType('resource').map((r) => ({
    name: r.name,
    type: r.initiatorType,
    duration: r.duration,
    start: r.startTime,
    transferSize: r.transferSize,
    decodedBodySize: r.decodedBodySize,
    // A same-origin hit served from cache reports transferSize 0 with a real body.
    cached: r.transferSize === 0 && r.decodedBodySize > 0,
  }));
  return {
    ttfb: nav.responseStart ?? 0,
    domContentLoaded: nav.domContentLoadedEventEnd ?? 0,
    load: nav.loadEventEnd ?? 0,
    fcp: fcp ? fcp.startTime : 0,
    lcp: window.__vitals.lcp,
    cls: window.__vitals.cls,
    longTasks: window.__vitals.longTasks,
    longTaskTime: window.__vitals.longTaskTime,
    resources,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const ms = (n) => `${Math.round(n)}`;
const kb = (n) => `${(n / 1024).toFixed(1)}`;
const basename = (u) => {
  try {
    return new URL(u).pathname.split('/').pop() || u;
  } catch {
    return u;
  }
};
const isJs = (r) => r.type === 'script' || /\.m?js(\?|$)/.test(r.name);

/**
 * A navigation landed where it was told to. For an authenticated page that
 * means same origin and not a login route; for a public page it means the same
 * route (a server that normalises "/x" to "/x/" has not bounced us anywhere).
 */
function landedOk(requestedUrl, finalUrl, requiresAuth) {
  const req = new URL(requestedUrl);
  const fin = new URL(finalUrl);
  if (fin.origin !== req.origin) return false;
  if (requiresAuth) return !/\/(auth\/)?login\b/i.test(fin.pathname);
  const norm = (p) => p.replace(/\/+$/, '') || '/';
  return norm(fin.pathname) === norm(req.pathname);
}

async function applyThrottling(page) {
  if (!CPU_THROTTLE && NET_PROFILE === 'off' && !COLD) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  if (COLD) await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (NET_PROFILES[NET_PROFILE]) {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NET_PROFILES[NET_PROFILE] });
  }
  if (CPU_THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
}

// ---------------------------------------------------------------------------
// One measured load
// ---------------------------------------------------------------------------
async function profileOnce(browser, storageState, { url, requiresAuth }) {
  const context = await browser.newContext(storageState ? { storageState } : {});
  await context.addInitScript(installCollectors);
  const page = await context.newPage();
  try {
    await applyThrottling(page);
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    // networkidle lets lazy chunks / deferred fetches land before the snapshot.
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    const metrics = await page.evaluate(readMetrics);
    return { ...metrics, finalUrl: page.url(), authOk: landedOk(url, page.url(), requiresAuth) };
  } finally {
    await context.close();
  }
}

async function profilePage(browser, storageState, entry) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    if (i > 0 && PACE_MS) await sleep(PACE_MS);
    try {
      runs.push(await profileOnce(browser, storageState, entry));
    } catch (err) {
      runs.push({ error: String(err?.message ?? err) });
    }
  }
  let ok = runs.filter((r) => !r.error);
  // Every run failing is usually transient (a DNS blip or a dev-server restart
  // takes out the whole burst at once), so pay for one backed-off retry before
  // writing the page off — otherwise a two-second hiccup costs a 50-page run.
  // Core's auth limiter is the one predictable cause: it allows 100 requests per
  // 60s per IP, and a page load costs several, so wait out the whole window
  // rather than retrying into the same wall.
  if (!ok.length) {
    const rateLimited = runs.some((r) => RATE_LIMIT_HINT.test(r.error ?? ''));
    if (rateLimited) process.stderr.write('rate-limited, waiting out the 60s auth window ... ');
    await sleep(rateLimited ? 65_000 : 3000);
    try {
      const retry = await profileOnce(browser, storageState, entry);
      runs.push(retry);
      ok = [retry];
    } catch (err) {
      runs.push({ error: String(err?.message ?? err) });
    }
  }
  if (!ok.length) return { ...entry, error: runs[0]?.error ?? 'all runs failed' };

  const pick = (k) => median(ok.map((r) => r[k]));
  // Chunk detail comes from the run whose LCP is closest to the median, so the
  // table matches the number reported above it.
  const lcpMedian = pick('lcp');
  const rep = ok.reduce((a, b) => (Math.abs(b.lcp - lcpMedian) < Math.abs(a.lcp - lcpMedian) ? b : a));
  const js = rep.resources.filter(isJs);

  return {
    ...entry,
    runs: ok.length,
    failed: runs.length - ok.length,
    authOk: ok.every((r) => r.authOk),
    finalUrl: rep.finalUrl,
    ttfb: pick('ttfb'),
    fcp: pick('fcp'),
    lcp: lcpMedian,
    dcl: pick('domContentLoaded'),
    load: pick('load'),
    cls: pick('cls'),
    longTasks: pick('longTasks'),
    longTaskTime: pick('longTaskTime'),
    requests: rep.resources.length,
    jsCount: js.length,
    jsTransferBytes: js.reduce((s, r) => s + r.transferSize, 0),
    jsDecodedBytes: js.reduce((s, r) => s + r.decodedBodySize, 0),
    totalTransferBytes: rep.resources.reduce((s, r) => s + r.transferSize, 0),
    chunks: js
      .map((r) => ({
        file: basename(r.name),
        transferBytes: r.transferSize,
        decodedBytes: r.decodedBodySize,
        durationMs: r.duration,
        startMs: r.start,
        cached: r.cached,
      }))
      .sort((a, b) => b.decodedBytes - a.decodedBytes),
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
function table(rows, cols) {
  const head = cols.map((c) => c.label);
  const body = rows.map((r) => cols.map((c) => String(c.get(r))));
  const width = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells) => cells.map((c, i) => (cols[i].right ? c.padStart(width[i]) : c.padEnd(width[i]))).join('  ');
  return [line(head), width.map((w) => '-'.repeat(w)).join('  '), ...body.map(line)].join('\n');
}

function report(results, skipped, loginFailures) {
  const good = results.filter((r) => !r.error);
  console.log(
    `\n=== page profile — ${good.length} page(s), ${RUNS} run(s) each, ${COLD ? 'cold' : 'warm'} cache` +
      `${CPU_THROTTLE > 1 ? `, ${CPU_THROTTLE}x CPU` : ''}` +
      `${NET_PROFILE !== 'off' ? `, ${NET_PROFILE} net` : ''} — median ms ===\n`
  );
  if (good.length) {
    console.log(
      table(good, [
        { label: 'app', get: (r) => r.app },
        { label: 'page', get: (r) => r.name },
        { label: 'role', get: (r) => r.role },
        { label: 'TTFB', get: (r) => ms(r.ttfb), right: true },
        { label: 'FCP', get: (r) => ms(r.fcp), right: true },
        { label: 'LCP', get: (r) => ms(r.lcp), right: true },
        { label: 'DCL', get: (r) => ms(r.dcl), right: true },
        { label: 'load', get: (r) => ms(r.load), right: true },
        { label: 'CLS', get: (r) => r.cls.toFixed(3), right: true },
        { label: 'blocking', get: (r) => `${ms(r.longTaskTime)} (${r.longTasks})`, right: true },
        { label: 'JS', get: (r) => `${r.jsCount} / ${kb(r.jsDecodedBytes)}KB`, right: true },
        { label: 'total KB', get: (r) => kb(r.totalTransferBytes), right: true },
        { label: 'auth', get: (r) => (r.authOk ? 'ok' : 'REDIRECTED') },
      ])
    );
  }

  if (SHOW_CHUNKS) {
    for (const r of good) {
      console.log(`\n--- ${r.app}/${r.name} — ${r.jsCount} JS chunks, ${kb(r.jsDecodedBytes)}KB decoded ---`);
      console.log(
        table(r.chunks, [
          { label: 'chunk', get: (c) => c.file },
          { label: 'decoded KB', get: (c) => kb(c.decodedBytes), right: true },
          { label: 'wire KB', get: (c) => (c.cached ? 'cache' : kb(c.transferBytes)), right: true },
          { label: 'start ms', get: (c) => ms(c.startMs), right: true },
          { label: 'dur ms', get: (c) => ms(c.durationMs), right: true },
        ])
      );
    }
  }

  // Coverage accounting: a silent skip reads as "we measured everything".
  if (skipped.length) {
    console.log(`\n--- skipped (${skipped.length}) — not measured ---`);
    for (const s of skipped) console.log(`${s.app}/${s.name}  ${s.path}  ${s.reason}`);
  }
  const failed = results.filter((r) => r.error);
  if (failed.length) {
    console.log(`\n--- failed (${failed.length}) ---`);
    for (const r of failed) console.log(`${r.app}/${r.name}  ${r.url}  ${r.error}`);
  }
  const redirected = good.filter((r) => !r.authOk);
  if (redirected.length) {
    console.log(`\n--- redirected (${redirected.length}) — numbers describe the redirect target, not the page ---`);
    for (const r of redirected) console.log(`${r.app}/${r.name}  as ${r.role}  ${r.url} -> ${r.finalUrl}`);
  }
  if (loginFailures.length) {
    console.log(`\n--- login failed (${loginFailures.length} role(s)) — their pages were not measured ---`);
    for (const l of loginFailures) console.log(`${l.role} (${l.email})  ${l.reason}`);
  }
  console.log(
    `\ncoverage: ${good.length} measured, ${redirected.length} redirected, ` +
      `${skipped.length} skipped, ${failed.length} failed`
  );
  return { failed: failed.length, redirected: redirected.length, skipped: skipped.length };
}

/**
 * Run provenance, mirroring perf-baseline.mjs's fingerprint so a page run and an
 * endpoint run can be attributed to the same target and commit.
 */
function fingerprint() {
  const g = (c) => {
    try {
      return execSync(c).toString().trim();
    } catch {
      return 'unknown';
    }
  };
  return {
    captured_at: new Date().toISOString(),
    target_label: TARGET_LABEL,
    targets: Object.fromEntries(Object.entries(APPS).map(([k, v]) => [k, v.baseUrl])),
    git_sha: g('git rev-parse --short HEAD'),
    git_branch: g('git branch --show-current'),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    runs: RUNS,
    cache: COLD ? 'cold' : 'warm',
    cpu_throttle: CPU_THROTTLE,
    network: NET_PROFILE,
    seed_note: 'Run `npm run dbseed` before measuring; unresolved dynamic ids are reported as skipped.',
  };
}

/**
 * Every page that did NOT yield a trustworthy number, in one list. `redirected`
 * rows are the important ones: they carry timings, but for the login page the
 * session bounced to — not for the route that was asked for.
 */
function collectErrors(results, skipped, loginFailures) {
  const errors = [];
  for (const l of loginFailures) {
    errors.push({
      app: 'core',
      page: `(login as ${l.role})`,
      role: l.role,
      path: '/auth/login',
      url: `${APPS.core.baseUrl}/auth/login`,
      kind: 'login-failed',
      reason: l.reason,
      affected_pages: l.affected,
    });
  }
  for (const r of results.filter((r) => r.error)) {
    errors.push({ app: r.app, page: r.name, role: r.role, path: r.path, url: r.url, kind: 'load-failed', reason: r.error });
  }
  for (const r of results.filter((r) => !r.error && !r.authOk)) {
    errors.push({
      app: r.app,
      page: r.name,
      role: r.role,
      path: r.path,
      url: r.url,
      kind: 'redirected',
      reason: `landed on ${r.finalUrl} instead — session not accepted for this route`,
      final_url: r.finalUrl,
    });
  }
  for (const s of skipped) {
    errors.push({ app: s.app, page: s.name, role: s.role, path: s.path, url: null, kind: 'skipped', reason: s.reason });
  }
  return errors;
}

/**
 * A page on a Vite dev server pulls hundreds of unbundled ESM modules — the raw
 * per-chunk list is ~12k entries across a full sweep, which is 100k lines of JSON
 * nobody reviews. Only the heaviest few carry the actionable signal (a 3.8MB icon
 * barrel shows up at rank 1), and the totals worth diffing are already their own
 * fields, so the committed artifact keeps the top CHUNK_LIMIT by transfer size
 * plus `chunkCount`. `--full-chunks` writes the untruncated list to a separate
 * page-chunks.json for a local deep-dive.
 */
const CHUNK_LIMIT = 5;

function trimChunks(r) {
  if (!r.chunks) return r;
  const byWeight = [...r.chunks].sort((a, b) => b.transferBytes - a.transferBytes);
  return { ...r, chunkCount: r.chunks.length, chunks: byWeight.slice(0, CHUNK_LIMIT) };
}

function writeArtifacts(results, skipped, loginFailures) {
  const dir = path.resolve(OUT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const env = fingerprint();
  const measured = results.filter((r) => !r.error && r.authOk);

  const vitalsPath = path.join(dir, 'page-vitals.json');
  fs.writeFileSync(
    vitalsPath,
    JSON.stringify({ env, measured_count: measured.length, chunks_per_page: CHUNK_LIMIT, results: results.map(trimChunks), skipped }, null, 2)
  );

  if (FULL_CHUNKS) {
    const chunksPath = path.join(dir, 'page-chunks.json');
    fs.writeFileSync(
      chunksPath,
      JSON.stringify(
        { env, results: results.filter((r) => r.chunks).map((r) => ({ app: r.app, name: r.name, role: r.role, chunks: r.chunks })) },
        null,
        2
      )
    );
    console.log(`\nwrote ${chunksPath} (untruncated chunk lists)`);
  }

  const errors = collectErrors(results, skipped, loginFailures);
  const errPath = path.join(dir, 'errors.json');
  const logPath = path.join(dir, 'errors.log');
  fs.writeFileSync(errPath, JSON.stringify({ env, errors }, null, 2));

  if (!errors.length) {
    fs.writeFileSync(logPath, `no errored pages — clean run (${measured.length} measured)\n`);
  } else {
    const lines = [`=== errored pages (${errors.length}; ${measured.length} measured cleanly) ===`, ''];
    for (const e of errors) {
      lines.push(`[${e.app}] ${e.page}  (role=${e.role}, kind=${e.kind})`);
      lines.push(`  path: ${e.path}`);
      if (e.url) lines.push(`  url:  ${e.url}`);
      if (e.final_url) lines.push(`  landed: ${e.final_url}`);
      if (e.affected_pages) lines.push(`  affected pages: ${e.affected_pages.join(', ')}`);
      lines.push(`  reason: ${e.reason}`);
      lines.push('');
    }
    fs.writeFileSync(logPath, lines.join('\n'));
  }
  console.log(`\nwrote ${vitalsPath}`);
  console.log(`wrote ${logPath} + ${errPath} (${errors.length} errored page(s))`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const selected = [];
for (const [appKey, appConfig] of Object.entries(APPS)) {
  if (APP_FILTER && !APP_FILTER.includes(appKey)) continue;
  for (const p of appConfig.pages) {
    if (PAGE_FILTER && !PAGE_FILTER.includes(p.name)) continue;
    if (ROLE_FILTER && !ROLE_FILTER.includes(p.role)) continue;
    selected.push({ ...p, app: appKey, baseUrl: appConfig.baseUrl });
  }
}
if (!selected.length) {
  console.error('no pages matched --app/--page/--role filters');
  process.exit(2);
}

const browser = await chromium.launch({ headless: !HEADED });
let exitCode = 0;
try {
  // One login per role that is actually needed, reused as storageState so every
  // measured load starts from a fresh context without paying for the login nav.
  // A role whose login fails is recorded and its pages are reported as errors —
  // aborting here would throw away the measurements every other role can still
  // produce, and the whole point of the errors file is to name what to fix.
  const states = new Map([['anon', undefined]]);
  const loginFailures = [];
  for (const role of new Set(selected.map((p) => p.role))) {
    if (role === 'anon') continue;
    const creds = credentialsFor(role);
    if (!creds) {
      loginFailures.push({
        role,
        email: '(none)',
        reason: `no seeded account configured for role "${role}" in pages.mjs ACCOUNTS`,
        affected: selected.filter((p) => p.role === role).map((p) => `${p.app}/${p.name}`),
      });
      continue;
    }
    // Sign-in is the most limiter-sensitive request in the run: the roles log in
    // back to back before any measuring starts, so the last one in the burst is
    // the first to be told "too many requests". Idle between them, and give a
    // throttled login the full window before deciding the role is unusable —
    // losing one role silently costs every page that only it can see.
    if (states.size > 1 && PACE_MS) await sleep(PACE_MS);
    for (let attempt = 0; ; attempt++) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await loginToCore(page, APPS.core.baseUrl, creds);
        states.set(role, await ctx.storageState());
        process.stderr.write(`logged in as ${role} (${creds.email})\n`);
        break;
      } catch (err) {
        const bodyText = await page
          .locator('body')
          .innerText()
          .then((t) => t.replace(/\s+/g, ' ').slice(0, 300))
          .catch(() => '(page text unavailable)');
        const reason = `${err.message} — landed on ${page.url()}; page said: ${bodyText}`;
        if (attempt < 1 && RATE_LIMIT_HINT.test(reason)) {
          process.stderr.write(`login as ${role} rate-limited, waiting out the 60s auth window ...\n`);
          await sleep(65_000);
          continue;
        }
        loginFailures.push({
          role,
          email: creds.email,
          reason,
          affected: selected.filter((p) => p.role === role).map((p) => `${p.app}/${p.name}`),
        });
        process.stderr.write(`login FAILED as ${role} (${creds.email}) — its pages will be reported as errors\n`);
        break;
      } finally {
        await ctx.close();
      }
    }
  }

  // Dynamic ids, resolved per (app, role) — what a student may list differs
  // from what an instructor or admin may.
  const paramCache = new Map();
  async function paramsFor(appKey, role) {
    const key = `${appKey}:${role}`;
    if (!paramCache.has(key)) {
      const ctx = await apiRequest.newContext({ storageState: states.get(role) });
      try {
        paramCache.set(key, await resolveParams(ctx, appKey, APPS.core.baseUrl));
      } catch {
        paramCache.set(key, {});
      } finally {
        await ctx.dispose();
      }
    }
    return paramCache.get(key);
  }

  const entries = [];
  const skipped = [];
  const failedRoles = new Set(loginFailures.map((l) => l.role));
  for (const p of selected) {
    // No session for this role — measuring would just time the login page.
    if (failedRoles.has(p.role)) continue;
    let urlPath = p.path;
    if (p.params?.length) {
      const resolved = await paramsFor(p.app, p.role);
      const filled = fillPath(p.path, p.params, resolved);
      if (filled.missing) {
        skipped.push({ ...p, reason: `could not resolve ${filled.missing.join(', ')} as ${p.role}` });
        continue;
      }
      urlPath = filled.path;
    }
    entries.push({
      app: p.app,
      name: p.name,
      role: p.role,
      path: urlPath,
      url: `${p.baseUrl}${urlPath}`,
      requiresAuth: p.role !== 'anon',
    });
  }

  const results = [];
  for (const entry of entries) {
    if (results.length && PACE_MS) await sleep(PACE_MS);
    process.stderr.write(`profiling ${entry.app}/${entry.name} (${entry.role}) ... `);
    const r = await profilePage(browser, states.get(entry.role), entry);
    process.stderr.write(r.error ? 'FAILED\n' : `LCP ${ms(r.lcp)}ms${r.authOk ? '' : ' REDIRECTED'}\n`);
    results.push(r);
  }

  const counts = report(results, skipped, loginFailures);
  writeArtifacts(results, skipped, loginFailures);
  if (counts.failed || counts.redirected || counts.skipped || loginFailures.length) exitCode = 1;
} finally {
  await browser.close();
}
process.exit(exitCode);
