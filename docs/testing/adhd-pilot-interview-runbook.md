# ADHD Assist pilot — interview runbook (start to finish)

Step-by-step plan so you walk into the session prepared and avoid confounds. Read this once the day before; use the checklists the day of.

> **Forms:** Participant fills [`adhd-pilot-participant-form.md`](./adhd-pilot-participant-form.md). You fill [`adhd-pilot-facilitator-sheet.md`](./adhd-pilot-facilitator-sheet.md). Metrics reference: [`adhd-user-reaction-recording.md`](./adhd-user-reaction-recording.md).

**Estimated time:** 35–45 minutes (25 min tasks + 10 min consent/setup/debrief).

---

## Phase 0 — At least 48 hours before (do not skip)

### 0.1 Technical proof

- [ ] Pull latest code; record **`git rev-parse HEAD`**
- [ ] Start dev server; open **`/chat`**
- [ ] Smoke test **Assist ON**: send “Explain gradient descent in plain language” → reply should have summary structure + **Next?** + ≤250 words
- [ ] Smoke test **Assist OFF**: same prompt → unconstrained style (control sanity)
- [ ] Network tab: confirm `adhdAssist: true/false` in POST body
- [ ] Run automation on same SHA (optional but recommended):

```bash
cd apps/core
EDUAI_BASE_URL=http://localhost:5173 \
EDUAI_COOKIE="..." \
EDUAI_MODEL=your-model \
EDUAI_API_KEYS_JSON='...' \
npm run eval:adhd -- --only S1,S2,S3 --mode both
```

- [ ] **G1 gate:** Assist ON pass rate ≥80% on structural checks — if not, **postpone** the interview and fix Phase 2 first

### 0.2 Ethics & admin

- [ ] Confirm tier with PI: **A** (self/team), **B** (advisory pilot), or **C** (formal BREB)
- [ ] Tier **B:** mini-consent printed or emailed; participant code assigned (`P01`, not legal name in shared files)
- [ ] Tier **C:** use **Qualtrics only** for research data — this paper form is **not** your official instrument
- [ ] Create folder `eval-runs/pilot/<SessionID>/` (git-ignored)

### 0.3 Materials prep

- [ ] Print or open **participant form** (one per person)
- [ ] Open **facilitator sheet** on your laptop
- [ ] Open **form-a-scenario-test-sheet.md** for exact paste strings
- [ ] Assign **counterbalance order** before they arrive:
  - Odd participant codes (P01, P03): **Baseline → Assist** for all blocks
  - Even codes (P02, P04): **Assist → Baseline**
- [ ] Same **model** and API keys locked for entire session — write model ID on facilitator sheet

### 0.4 What you say in the invite email

Include:

- 35–45 min on Zoom or in person
- Browser + EduAI login ready
- No course/materials needed
- They will **not** toggle anything — you run the interface
- ADHD diagnosis **not required** for tier B advisory unless your PI says otherwise

---

## Phase 1 — 15 minutes before participant arrives

- [ ] Close unrelated tabs; silence notifications
- [ ] Log into EduAI as **facilitator** (not their account unless protocol says otherwise)
- [ ] `/chat` loaded; **no course** selected
- [ ] Model selected in UI matches sheet
- [ ] Stopwatch or timer ready (latency)
- [ ] Participant form + pen, or second device for them to type ratings
- [ ] Read **DO NOT** list below one more time

---

## Phase 2 — Welcome & consent (5 min)

**Script (adapt to tier):**

> “Thanks for helping. You’ll use EduAI chat twice — same tasks, two different reply styles. One style has a feature called Assistive mode. I’ll control the toggle; you just read and rate. There are no wrong answers. Takes about half an hour.”

- [ ] Tier B: collect signed mini-consent
- [ ] Record Session ID + participant code on both forms
- [ ] **Do not** explain what Assist does in detail (avoid demand characteristics) — you may say: “The second style is meant to be more structured.”

**DO NOT:**

- ❌ Let them click the toggle
- ❌ Tell them Assist always “should” feel better
- ❌ Mention Top summary / Next? by name before T1 Assist
- ❌ Select a course or upload personal materials for T1–T3

---

## Phase 3 — Task battery (25 min)

For **each block** (T1, T2, T3), run **both conditions** in the order on your counterbalance sheet.

### Universal rules (every block, every condition)

1. **New chat** before each block × condition (8 new chats total)
2. You set toggle → verify label shows **On** or **Off**
3. You paste user text **verbatim** from facilitator sheet
4. Wait for **full** reply before next turn
5. Participant reads in silence; you watch for confusion
6. After final turn of block, participant fills **that block’s section** on their form (you wait — no rushing)
7. You score **AI-side + rubric** on facilitator sheet while they write, or immediately after

### Block T1 (~5 min)

| Step | You do |
| ---- | ------ |
| 1 | New chat; toggle = **first condition** for this participant |
| 2 | Paste T1 turn 1 (gradient descent) |
| 3 | Participant rates **T1 · [condition]** section |
| 4 | New chat; toggle = **other condition** |
| 5 | Paste same T1 turn 1 |
| 6 | Participant rates other T1 section + quick compare |

### Block T2 (~10 min)

| Step | You do |
| ---- | ------ |
| 1 | New chat; toggle = condition 1 |
| 2 | Paste turn 1 → wait → turn 2 → wait → turn 3 |
| 3 | **Also score turn 2** on facilitator sheet (drift probe row) |
| 4 | Participant rates **last reply** (turn 3) on form |
| 5 | New chat; toggle = condition 2; repeat all 3 turns |
| 6 | Participant rates + quick compare |

**Watch T2 turn 2 closely:** Baseline often merges topics; Assist should redirect. Note `DRIFT` vs `HELD` on your sheet.

### Block T3 (~10 min)

| Step | You do |
| ---- | ------ |
| 1 | New chat; toggle = condition 1 |
| 2 | Paste turn 1 (study plan) → wait |
| 3 | **Same chat** — paste turn 2 (first 25 minutes) |
| 4 | Participant rates last reply + resumption extra question |
| 5 | New chat; toggle = condition 2; repeat turns 1–2 in same chat |
| 6 | Participant rates + quick compare |

**DO NOT for T3:**

- ❌ Open turn 2 in a new chat unless you document it — protocol uses **same chat** for turn 2 so resumption is tested

---

## Phase 4 — Debrief (3 min)

Participant fills **End of session debrief** on their form.

**Optional verbal prompts:**

- “Which mode did you prefer overall?”
- “Anything confusing about the structured one?”
- “Would you use this for real studying?”

You log answers on facilitator sheet **Qual: debrief notes**.

---

## Phase 5 — After they leave (20 min — same day)

- [ ] Transfer participant 1–7 scores to facilitator sheet (if paper)
- [ ] Complete all AI compliance + expert rubric columns
- [ ] Compute paired deltas (Assist − Baseline) per block for: frustration, mental demand, effort, would want again
- [ ] Update go/no-go table in [`adhd-user-reaction-recording.md`](./adhd-user-reaction-recording.md) § 7
- [ ] Save transcripts to `eval-runs/pilot/<SessionID>/` **only if** tier/consent allows; else delete
- [ ] Write `session-meta.json` with SHA, model, order, tier
- [ ] **Do not** commit participant text to git

---

## DO NOT list (confounds that invalidate the session)

| Mistake | Why it ruins data |
| ------- | ----------------- |
| Participant toggles mid-task | IV contamination |
| Same chat across Baseline and Assist | Mode bleed |
| Different model between conditions | IV breaks |
| Course/RAG enabled | Extra variables |
| Paraphrasing user prompts | Breaks comparability to S1–S3 |
| Coaching (“notice the bullets”) | Demand characteristics |
| Skipping T2 turn 2 | Drift probe lost |
| Rating before reply finishes | Incomplete stimulus |
| Merging pilot data into Track B Qualtrics | Ethics violation |

---

## If something breaks mid-session

| Problem | Recovery |
| ------- | -------- |
| API error / empty reply | Note on sheet; retry once; if fail, mark block **incomplete** — do not substitute a different prompt |
| Wrong toggle state | **Stop** — discard that chat; new chat with correct toggle; tell PI |
| Participant needs break | Pause timer; resume same block — do not switch conditions mid-block |
| Reply streams forever | Wait for finish; record latency; note if unusually long |

---

## Session timeline (at a glance)

```
0:00  Consent + codes
0:05  T1 Baseline (or Assist per order)
0:08  T1 other condition
0:10  T2 condition 1 (3 turns)
0:15  T2 condition 2 (3 turns)
0:20  T3 condition 1 (2 turns, same chat)
0:24  T3 condition 2 (2 turns, same chat)
0:27  Debrief
0:30  Done — participant leaves
```

---

## Minimum sessions before Phase 3 decision

| Evidence | Target |
| -------- | ------ |
| Automation G1 | 1 run, ≥80% Assist structural pass |
| Pilot sessions tier A/B | ≥ **3** participants (or 1 self + 2 advisors) |
| Paired blocks | ≥ **18** participant-rating rows (3 ppt × 6 block-conditions) |
| PI sync | Review go/no-go G1–G5 together |

---

## File checklist (day of)

- [ ] [`adhd-pilot-participant-form.md`](./adhd-pilot-participant-form.md) — for them
- [ ] [`adhd-pilot-facilitator-sheet.md`](./adhd-pilot-facilitator-sheet.md) — for you
- [ ] [`form-a-scenario-test-sheet.md`](../literature/form-a-scenario-test-sheet.md) — paste source
- [ ] This runbook — on second monitor or printed

---

## Related

- Full metric map: [`adhd-user-reaction-recording.md`](./adhd-user-reaction-recording.md)
- Phase roadmap: [`adhd-assist-architecture-phases.md`](../literature/adhd-assist-architecture-phases.md)
