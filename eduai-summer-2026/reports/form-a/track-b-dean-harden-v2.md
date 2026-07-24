# Track B — Dean harden (policy v2.0)

**Branch:** `feat/adhd-dean-track-b-harden` (off `origin/development`)  
**Code:** `apps/core` ADHD oversight stack  
**Policy stamp:** `ADHD_ASSIST_POLICY_VERSION = "2.0"` (do **not** pool with v1.x freeze cohorts)

## What changed

1. **No fail-open:** rejected/failed LLM rewrites → one retry with reject reasons → `forced_deterministic` wrap (anchors, urgency strip, cap trim, optional Sources).
2. **Dean context:** rewrite prompt always includes learner message + profile Teacher policy slice.
3. **Anchor normalization:** `* Top summary` / similar → `**Top summary**`; forward-offer `Next?` → `**Next?**` (comprehension-check Next? not promoted).
4. **Sources when tools/RAG ran:** `toolsUsed` from chat → require Sources footer; generic line if pages unknown.
5. **Telemetry methods:** `llm_retry`, `forced_deterministic` (plus existing `none` / `deterministic` / `llm`).

## How to test locally

### Unit (required)

```bash
cd /Users/ahabmasudsiddiqui/Code/EduAICoreLearning/apps/core
nvm use 20.19.0
npx vitest run \
  app/tests/unit/adhd-oversight.test.ts \
  app/tests/unit/adhd-metrics.test.ts \
  app/tests/unit/assistive-events.server.test.ts \
  app/tests/unit/chat-oversight.route.test.ts
```

### Manual chat smoke (Assist ON, oversight on)

1. Start Core per local-dev rule (db + `edu-ai` on :3000).
2. Login, pick **Gemini 2.5 Flash**, Assist **ON**.
3. Probes:
   - S1 gradient-descent → expect `**Top summary**` + `**Next?**`.
   - Long wall-of-text ask → still under ~250 words with anchors (may show `forced_deterministic` in telemetry).
   - "Do this quickly…" style content in a draft path → no urgency words in final reply.
   - Turn that hits RAG/tools → trailing `Sources: Retrieved materials used this turn.` (or a real Sources line).

### Synthetic Form A three-arm (research)

**Do not overwrite Paper 1 freeze dirs.** Use a fresh `--out` per arm and a label.

Two prerequisites that are easy to miss:

- **Course scope.** Interactive chats are course-scoped since #657, so a run
  without `EDUAI_COURSE_ID` fails every turn with `COURSE_REQUIRED`. The eval
  script now requires it (`EDUAI_COURSE_CODE` also works).
- **Session cookie.** `EDUAI_COOKIE` must be a live `better-auth.session_token`
  for an account that has a provider API key saved in EduAI (locally that is
  `admin@eduai.local`). The keys come from the DB, so `EDUAI_API_KEYS_JSON` only
  has to be valid JSON (`{}`).

The oversight flag is read by the server process, not the eval script, so the
prompt-only arm needs its own Core instance with the Dean off. Running it on a
spare port avoids restarting your main dev server:

```bash
cd /Users/ahabmasudsiddiqui/Code/EduAICoreLearning/apps/core
ADHD_ASSIST_OVERSIGHT=false npx react-router dev --port 3010   # prompt-only arm only
```

Then, per arm (baseline and oversight against :3000, prompt-only against :3010):

```bash
cd /Users/ahabmasudsiddiqui/Code/EduAICoreLearning/apps/core
export EDUAI_BASE_URL=http://localhost:3000
export EDUAI_COOKIE='better-auth.session_token=<token>'
export EDUAI_MODEL=google:gemini-2.5-flash
export EDUAI_API_KEYS_JSON='{}'
export EDUAI_COURSE_ID=seed_course_math320

npm run eval:adhd -- --only S1,S2,S3,S5 --mode baseline \
  --label trackb-baseline --out ../../eval-runs/<stamp>/baseline
npm run eval:adhd -- --only S1,S2,S3,S5 --mode assist-oversight \
  --label trackb-oversight-v2.0 --out ../../eval-runs/<stamp>/assist-oversight
EDUAI_BASE_URL=http://localhost:3010 npm run eval:adhd -- --only S1,S2,S3,S5 \
  --mode assist-prompt-only --label trackb-prompt-only \
  --out ../../eval-runs/<stamp>/assist-prompt-only
```

Then read the telemetry side (oversight path histogram, policy stamp):

```bash
cd /Users/ahabmasudsiddiqui/Code/EduAICoreLearning/apps/core
npx tsx ../../eduai-summer-2026/reports/scripts/report-adhd-metrics.ts \
  --since <ISO> --event response_compliance
```

## First three-arm result under v2.0

Run: 2026-07-24, `eval-runs/2026-07-24-trackb/`, Gemini 2.5 Flash writer and
Dean, course `MATH 320`, S1/S2/S3/S5 = 8 turns per arm.

| Arm | Strict structural | Contextual / profile shape |
|-----|------------------:|---------------------------:|
| Baseline (Assist off) | 0/8 | 0/8 |
| Assist, prompt-only (Dean off) | 0/8 | 1/8 |
| Assist + Dean (policy 2.0) | 7/8 | 8/8 |

The one strict miss in the Dean arm is `S2.t2`, the topic-switch redirect turn,
which is *supposed* to be a short redirect without the full anchor set; it passes
on the profile-aware criterion. So the Dean arm is 8/8 on the criterion the
policy actually holds it to.

Oversight path histogram for that arm (`response_compliance`, policy 2.0):

| Method | Turns | Profile pass |
|--------|------:|-------------:|
| `forced_deterministic` | 3 | 100% |
| `deterministic` | 2 | 100% |
| `none` (draft already compliant) | 2 | 100% |
| `llm` | 1 | 100% |
| `llm_retry` | 1 | 100% |

Reading: with this writer the prompt alone produced **zero** compliant turns —
Gemini 2.5 Flash writes its own shape ("TLDR", "Continue") instead of the policy
anchors — and every compliant turn in the Dean arm came from oversight. Track B's
new paths carried a third of the arm (3 forced wraps, 1 retry): under the old
fail-open behaviour those four turns would have shipped non-compliant.

Caveat: n=8 turns, single writer model, single run. This is a smoke-level signal
that fail-closed works, not a replacement for the frozen Paper 1 numbers
(`paper1-frozen-eval-numbers.md`, prompt-only ~76% / oversight ~80% on the
profile criterion), which were measured on a different policy version and a
different writer configuration. Do not pool v1.x and v2.0 cohorts.

## Telemetry gap found and fixed during this run

The baseline and prompt-only arms were writing **no** `response_compliance` rows.
The streaming `onFinish` hook returns early on non-streaming turns, and the
non-streaming branch never logged compliance itself — so any turn that skipped
the Dean (baseline, or Assist with oversight off) was invisible in telemetry
whenever the caller posted `streaming: false`, which is exactly what the eval
harness does. Fixed in `apps/core/app/routes/api/chat.ts` with two regression
tests in `chat-oversight.route.test.ts`. Before this fix, DB-side arm comparison
was impossible and only the eval CSVs had the baseline numbers.

## Research use

| Question | How this helps |
|----------|----------------|
| Does fail-closed Dean close the modest RQ3 gap? | Re-run three-arm under v2.0; report delta vs freeze without pooling |
| How often is LLM rewrite vs forced wrap? | `oversightMethod` in `response_compliance` events, summarised by `report-adhd-metrics.ts` |
| How much of compliance is prompt vs oversight? | Prompt-only vs Dean arms are now both logged, so the split is measurable per turn |
| Is structure now enforced even when the model truncates? | Forced wrap cases in long-draft probes |
| Separate Dean model later (#716)? | Cleaner auditor contract; model-sizing experiment measures models against a complete Dean, not fail-open |

Paper 1 freeze numbers stay authoritative until PI re-freezes. This branch is **post-freeze** follow-on evidence.
