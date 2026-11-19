// Lighthouse (performance) for the main Core / AI Tutor / Question Maker pages (#2134).
//
// Runs against a Chrome you have already signed in to, so it works on prod without a seed
// password. Start one with a throwaway profile, sign in, leave it open, then run this:
//
//   chrome --remote-debugging-port=9333 --user-data-dir=<empty dir> https://my.eduai.ok.ubc.ca
//   CORE_URL=https://my.eduai.ok.ubc.ca AI_TUTOR_URL=https://aitutor.eduai.ok.ubc.ca \
//   QM_URL=https://questionmaker.eduai.ok.ubc.ca LH_CORE_COURSE=<id> LH_AIT_COURSE=<id> \
//   LH_AIT_LESSON=<id> LH_QM_COURSE=<id> npm run perf:lighthouse -- --out=docs/perf/frontend/lighthouse-<date>
//
// --apps=core,aitutor,qm limits the run. RUNS (default 3) runs per page and mode; medians are kept.
// Storage reset is off so the session survives; the HTTP cache is cleared before every run instead.
import { mkdirSync, writeFileSync } from "node:fs";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import puppeteer from "puppeteer-core";

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const env = process.env;
const CORE = env.CORE_URL ?? "https://dev.eduai.ok.ubc.ca";
const AIT = env.AI_TUTOR_URL ?? "https://dev.aitutor.eduai.ok.ubc.ca";
const QM = env.QM_URL ?? "https://dev.questionmaker.eduai.ok.ubc.ca";
const coreCourse = env.LH_CORE_COURSE ?? "seed_course_cosc101";
const aitCourse = env.LH_AIT_COURSE ?? "1";
const aitLesson = env.LH_AIT_LESSON ?? "47";
const qmCourse = env.LH_QM_COURSE ?? "1";

const PAGES = [
  ["core", "Core", "Dashboard", `${CORE}/dashboard`],
  ["core", "Core", "Course page", `${CORE}/courses/${coreCourse}`],
  ["core", "Core", "Course chat", `${CORE}/chat?courseId=${coreCourse}`],
  ["core", "Core", "Materials tab", `${CORE}/courses/${coreCourse}?tab=materials`],
  ["aitutor", "AI Tutor", "Dashboard", `${AIT}/dashboard`],
  ["aitutor", "AI Tutor", "Course page", `${AIT}/instructor/courses/${aitCourse}`],
  ["aitutor", "AI Tutor", "Lesson", `${AIT}/instructor/lesson/${aitLesson}`],
  ["qm", "Question Maker", "Dashboard", `${QM}/dashboard`],
  ["qm", "Question Maker", "Course workspace", `${QM}/courses/${qmCourse}`],
  ["qm", "Question Maker", "Question library", `${QM}/library`],
];

// Lighthouse's mobile default already applies 4x CPU + slow 4G; desktop-4x is a slower laptop.
const desktop4x = {
  ...desktopConfig,
  settings: {
    ...desktopConfig.settings,
    throttling: { ...desktopConfig.settings.throttling, cpuSlowdownMultiplier: 4 },
  },
};
const MODES = [
  ["desktop", desktopConfig],
  ["mobile", undefined],
  ["desktop-4x", desktop4x],
];

const apps = arg("apps", "core,aitutor,qm").split(",");
const port = Number(arg("port", "9333"));
const runsPerMode = Number(env.RUNS ?? 3);
const outDir = arg("out", "docs/perf/frontend/lighthouse");
mkdirSync(outDir, { recursive: true });

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function summarise(lhr) {
  const a = lhr.audits;
  const failing = (id) => a[id] && (a[id].score ?? 1) < 0.9;
  return {
    score: Math.round((lhr.categories.performance.score ?? 0) * 100),
    fcp: a["first-contentful-paint"].numericValue,
    lcp: a["largest-contentful-paint"].numericValue,
    tbt: a["total-blocking-time"].numericValue,
    cls: a["cumulative-layout-shift"].numericValue,
    bootup: a["bootup-time"].numericValue,
    finalUrl: lhr.finalDisplayedUrl,
    runtimeError: lhr.runtimeError?.code ?? null,
    opportunities: Object.values(a)
      .filter(
        (x) => x.details?.type === "opportunity" && failing(x.id) && (x.numericValue ?? 0) > 100,
      )
      .sort((x, y) => y.numericValue - x.numericValue)
      .slice(0, 4)
      .map((x) => `${x.title} (~${Math.round(x.numericValue)} ms)`),
  };
}

const browser = await puppeteer.connect({
  browserURL: `http://127.0.0.1:${port}`,
  defaultViewport: null,
});
const results = [];
let lighthouseVersion;
for (const [appKey, app, page, url] of PAGES.filter((p) => apps.includes(p[0]))) {
  for (const [mode, config] of MODES) {
    const runs = [];
    for (let i = 0; i < runsPerMode; i++) {
      const tab = await browser.newPage();
      const cdp = await tab.createCDPSession();
      await cdp.send("Network.clearBrowserCache");
      const { lhr } = await lighthouse(
        url,
        {
          port,
          output: "json",
          onlyCategories: ["performance"],
          disableStorageReset: true,
          logLevel: "error",
        },
        config,
        tab,
      );
      await tab.close();
      lighthouseVersion = lhr.lighthouseVersion;
      const run = summarise(lhr);
      runs.push(run);
      console.log(
        app,
        page,
        mode,
        `run ${i + 1}:`,
        run.score,
        `LCP ${Math.round(run.lcp)}`,
        `TBT ${Math.round(run.tbt)}`,
        run.runtimeError ?? "",
      );
    }
    const rep = [...runs].sort((x, y) => x.score - y.score)[Math.floor(runs.length / 2)];
    results.push({
      app: appKey,
      page,
      url,
      mode,
      runs: runs.length,
      score: median(runs.map((r) => r.score)),
      fcpMs: Math.round(median(runs.map((r) => r.fcp))),
      lcpMs: Math.round(median(runs.map((r) => r.lcp))),
      tbtMs: Math.round(median(runs.map((r) => r.tbt))),
      cls: Number(median(runs.map((r) => r.cls)).toFixed(3)),
      jsBootupMs: Math.round(median(runs.map((r) => r.bootup))),
      finalUrl: rep.finalUrl,
      runtimeErrors: runs.map((r) => r.runtimeError).filter(Boolean),
      topOpportunities: rep.opportunities,
    });
  }
}
await browser.disconnect();

const out = {
  env: {
    captured_at: new Date().toISOString(),
    lighthouse: lighthouseVersion,
    targets: { core: CORE, aiTutor: AIT, questionMaker: QM },
    runsPerMode,
    cache: "cold (HTTP cache cleared per run)",
  },
  results,
};
writeFileSync(`${outDir}/lighthouse.json`, `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${outDir}/lighthouse.json`);
