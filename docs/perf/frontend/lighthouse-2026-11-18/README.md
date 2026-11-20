# Page speed check (Lighthouse), 2026-11-18

Issue #2134, part of the MVP performance testing (#2131). Page load only, not AI response time.

- **Where:** dev (`dev.eduai.ok.ubc.ca`, `dev.aitutor…`, `dev.questionmaker…`), signed in as the
  seeded instructor `instructor.cs`, COSC 101. Dev serves the same hashed production builds as prod.
  No prod login was available; see [Dev vs prod](#dev-vs-prod) for what that changes.
- **How:** Lighthouse 12.6 (performance only) in Chrome 157, 3 runs per page and mode with the HTTP
  cache cleared each time; medians below. `npm run perf:lighthouse` reproduces it.
- **Modes:** *desktop* = Lighthouse desktop preset (a normal laptop); *mobile* = Lighthouse default
  (simulated slow 4G + 4× CPU); *desktop 4×* = desktop with 4× CPU slowdown (a slower laptop).
- **Data:** [`lighthouse.json`](lighthouse.json) (every number, plus request counts, JS bytes and
  Lighthouse's top opportunities per page), [`early-input.json`](early-input.json) (the #1941 check).

## Results

Score / Largest Contentful Paint / Total Blocking Time.

| Page | Desktop | Mobile | Desktop 4× |
|---|---|---|---|
| Core · Dashboard | 88 · 1.3 s · 150 ms | 62 · 3.6 s · 900 ms | 63 · 1.8 s · 620 ms |
| Core · Course page | 76 · 0.8 s · 540 ms | 44 · 3.1 s · 2.2 s | 70 · 0.7 s · 2.2 s |
| Core · Course chat | 98 · 0.8 s · 70 ms | 68 · 3.4 s · 820 ms | 76 · 0.9 s · 530 ms |
| Core · Materials tab | 80 · 0.8 s · 420 ms | 54 · 3.2 s · 2.5 s | 69 · 0.8 s · 2.4 s |
| AI Tutor · Dashboard | 63 · 2.7 s · 480 ms | 37 · 11.5 s · 1.2 s | 48 · 3.6 s · 1.5 s |
| AI Tutor · Course page | 78 · 2.4 s · 220 ms | 36 · 12.6 s · 1.3 s | 55 · 2.4 s · 1.0 s |
| AI Tutor · Lesson | 58 · 3.2 s · 500 ms | 32 · 16.5 s · 2.4 s | 48 · 3.3 s · 2.3 s |
| QM · Dashboard | 78 · 2.3 s · 80 ms | 33 · 10.2 s · 1.3 s | 47 · 2.6 s · 1.1 s |
| QM · Course workspace | 72 · 2.9 s · 90 ms | 32 · 13.8 s · 1.4 s | 39 · 3.4 s · 1.6 s |
| QM · Question library | 65 · 2.2 s · 420 ms | 30 · 10.7 s · 2.2 s | 49 · 2.8 s · 2.6 s |

Layout shift above the 0.1 "good" line: Core course page on mobile (0.30), Core materials tab on
mobile (0.13), Core dashboard on desktop (0.14), QM dashboard and course workspace on desktop (0.12).

### Clicks and typing right after load (4× CPU, #1941)

Each case acts as soon as the element is visible, then checks 4 s later.

| Case | Lost | Element visible after |
|---|---|---|
| Core course page: click Materials / Enrollments tab | 0 / 10 | 0.7–1.4 s |
| AI Tutor course page: click Submissions tab | 0 / 5 | 2.8–3.5 s |
| QM course workspace: click Questions tab | 0 / 5 | 4.5–5.3 s |
| QM library: type in search | 0 / 5 | 4.5–8.5 s |
| **Core course chat: type in the message box** | **12 / 35** | 0.8–1.9 s |

The tab fix from #2116 holds. The chat message box still drops text typed in roughly the first
1.2 s: every lost attempt started before 1.2 s, and every attempt after that kept its text. It is the same
`<textarea>` before and after hydration and no hydration error is logged, so the controlled
`value={input}` is overwriting what was typed before React attached. Happens on `/chat` with and
without `?courseId`. Needs its own issue.

## Verdict

- **Core passes.** Every page shows its content within 1.3 s on a normal laptop and within 1.8 s
  at 4× CPU. The cost is JavaScript after that: the course page and materials tab block the main
  thread for 2.2–2.5 s at 4× CPU.
- **AI Tutor and Question Maker are borderline on dev** (2.2–3.2 s LCP on desktop, AI Tutor lesson
  the worst) and slow on the mobile profile (10–16.5 s). Most of that gap is dev-specific (no
  compression, below), so they need a re-run on prod before calling them.
- Nothing became unusable at 4× CPU, but QM takes ~4.5–5 s before its course tabs appear.

**Slowest pages:** AI Tutor lesson, QM course workspace, AI Tutor course page, AI Tutor dashboard
(mobile LCP 11.5–16.5 s); for main-thread blocking at 4× CPU, QM library (2.6 s), Core materials
tab (2.4 s), AI Tutor lesson (2.3 s) and Core course page (2.2 s).

## Biggest causes

1. **AI Tutor and QM send JS and CSS uncompressed on dev.** Apache on s378 compresses nothing; Core
   is fine because Node compresses its own responses. That is 0.9–1.6 MB extra per page
   (`uncompressedSavingsKB` in the data). Prod gzips these files, so this one is dev-only.
2. **HTTP/1.1 everywhere, prod included.** All four hosts (dev and `my.eduai.ok.ubc.ca`) only
   negotiate HTTP/1.1, so the 40–108 requests per page queue on six connections. Lighthouse puts
   it at 0.2–3.4 s per page. This PR adds `Protocols h2 http/1.1` to the vhosts (guarded on
   `mod_http2`) and a provisioning step to enable the module.
3. **Question Maker's 1.1 MB `index` chunk.** One bundle on every QM page, ~45 % of it unused on
   the page being viewed. Splitting it by route is the biggest QM-side win.
4. **AI Tutor and QM render only in the browser.** Nothing meaningful paints until all their JS has
   loaded and run (73–85 scripts on AI Tutor), which is why their LCP follows network speed so
   closely. Core server-renders, so its first paint is its main content.
5. **AI Tutor lesson loads a 445 KB `mermaid` chunk** (from `streamdown`), 58 % unused, making the
   lesson twice the JS of the other AI Tutor pages.
6. **Core hydration on the course page.** At 4× CPU, hydrating the course page runs as long tasks of
   0.5–1 s (in `vendor-react`), which is where Core's TBT comes from.

## Dev vs prod

Checked against prod with plain requests: Core is gzipped on both; AI Tutor and QM assets are
gzipped on prod but not on dev; neither has HTTP/2. So the Core numbers and every blocking-time /
4× CPU / early-input result carry over to prod, and AI Tutor and QM load times on prod should be
noticeably better than above. To confirm, someone with a prod instructor login runs:

```bash
# Chrome with a throwaway profile; sign in to prod in it and leave it open
chrome --remote-debugging-port=9333 --user-data-dir=<empty dir> https://my.eduai.ok.ubc.ca
cd scripts/page-profile && npm install && cd ../..
CORE_URL=https://my.eduai.ok.ubc.ca AI_TUTOR_URL=https://aitutor.eduai.ok.ubc.ca \
QM_URL=https://questionmaker.eduai.ok.ubc.ca LH_CORE_COURSE=<id> LH_AIT_COURSE=<id> \
LH_AIT_LESSON=<id> LH_QM_COURSE=<id> \
  npm run perf:lighthouse -- --apps=aitutor,qm --out=docs/perf/frontend/lighthouse-<date>-prod
```

## Follow-ups

- Course chat message box drops text typed before hydration (above).
- QM: split the `index` chunk by route.
- AI Tutor: load `mermaid` only when a lesson has a diagram.
- s378: enable `mod_deflate` so dev numbers match prod.
- Prod: enable `mod_http2` (checklist step added here) and re-run AI Tutor / QM.
