# ADHD Assist Pilot — Facilitator Sheet

**Study:** H26-00906 · Form A / Track B UX  
**Audience:** Facilitator only (do not give to participants)  
**Last updated:** 2026-06-22 (includes #708 course UX: colours, term filter, material preview, motion)

**Related docs:** [Phase 3 User Testing Guide](../eduai-summer-2026/PHASE_3_USER_TESTING_GUIDE.md) · Qualtrics item list: [adhd-pilot-qualtrics-items.md](./adhd-pilot-qualtrics-items.md)

---

## Before the session

| Check | Notes |
|-------|--------|
| Build / branch | Record git SHA or PR (#751 chat UX, #752 courses UX) |
| Login | `student1@eduai.local` / `EduAI2026!` (or participant account) |
| Model | Same model for entire session (e.g. Gemini 2.5 Flash) |
| Assist counterbalance | Half **OFF→ON**, half **ON→OFF** |
| Qualtrics | Pre-link + post-link ready; participant ID matches spreadsheet |
| Stopwatch | Phone or browser timer for manual latencies |
| Screen record | Only if BREB consent covers it |

**Spoken script rule:** Say “Assistive Mode” / “Baseline mode.” Do **not** say “ADHD mode” or “disability features.”

---

## Two research lanes (keep separate in notes)

| Lane | What you are testing | IV |
|------|----------------------|-----|
| **Track A** | Chat Assist policy (structure, caps, oversight) | Assist **OFF vs ON** |
| **Track B** | Platform UX (#708): courses, colours, navigation, motion | UI version (post-#708) — **same for both Assist conditions** |

Course colour / term filter / material preview / scroll motion do **not** change when Assist toggles. Run **Track B once** per session (before or after both Assist blocks, not split by Assist).

---

## Session flow (~55–65 min)

| # | Block | Time | Qualtrics |
|---|--------|------|-----------|
| 1 | Consent + demographics | 5 min | **Pre-survey** (open) |
| 2 | Orientation | 5 min | — |
| 3 | **Track B — Course UX** (COURSE-1–4) | 10 min | **Course UX block** (after block) |
| 4 | Break | 3 min | — |
| 5 | **Condition 1** (Assist per counterbalance): NAV-1, AI-1, AI-2 | 15–18 min | **NASA-TLX + focus** (condition 1) |
| 6 | Break | 5 min | Fresh chat for condition 2 |
| 7 | **Condition 2** (opposite Assist): repeat AI tasks (+ optional NAV-1 short) | 15–18 min | **NASA-TLX + focus** (condition 2) |
| 8 | Debrief | 5 min | **SUS + overall + open comments** (post-survey) |

---

## Master data row (spreadsheet columns)

Copy one row per participant. Facilitator fills timing columns; Qualtrics fills scales.

| Column | Example |
|--------|---------|
| `participant_id` | P02 |
| `session_date` | 2026-06-22 |
| `ui_version` | post-708 |
| `git_sha` | dfb26d1 |
| `assist_order` | OFF_then_ON |
| `model` | gemini-2.5-flash |
| `motion_reduced_setting` | Y/N (Settings → Accessibility) |
| **Track B** | |
| `course_find_ms` | 9200 |
| `course_find_errors` | 0 |
| `customized_course` | Y/N |
| `customize_time_s` | 45 |
| `inside_outside_match` | Y/N/NA |
| `term_filter_used` | Y/N |
| `term_filter_hinted` | Y/N |
| `material_preview_used` | Y/N |
| `material_preview_ms` | 3100 |
| **Track A — Condition 1** | |
| `c1_assist` | OFF |
| `c1_nav1_initiation_ms` | |
| `c1_nav1_reorient_ms` | |
| `c1_ai2_turn3_reorient_ms` | |
| **Track A — Condition 2** | |
| `c2_assist` | ON |
| `c2_nav1_initiation_ms` | |
| `c2_nav1_reorient_ms` | |
| `c2_ai2_turn3_reorient_ms` | |
| `facilitator_notes` | Free text |

---

## Track B — Course UX tasks (#708)

**Goal:** Measure course discrimination, personalization, filtering, materials, and felt calm vs distraction.  
**Route:** Log in as student → **Courses** (`/courses`).

### COURSE-1 — Find the right course

**Say:** “Without using search, open the course **[name a specific seeded course, e.g. COSC 101 / Computer Studies]**.”

1. Start timer when `/courses` is fully loaded.
2. Stop when correct course **detail** page opens.
3. Count wrong clicks / backtracks.

**Record:** `course_find_ms`, `course_find_errors`, completed Y/N.

**Probe (optional):** “Was it easy to tell your courses apart?” (1–7 → goes to Qualtrics CU-1)

---

### COURSE-2 — Personalize appearance (optional discovery)

**Say:** “If you’d like, you can change how one of your courses looks — colour or nickname. Take a moment to try that if you want, then open that course.”

- Do **not** force customization; note if they find ⋮ on their own.
- If they customize: check **course list card** vs **course detail hero** — same colour?

**Record:** `customized_course` Y/N, `customize_time_s`, `inside_outside_match` Y/N/NA, facilitator quote.

**If they skip:** “That’s fine — we’ll continue.”

---

### COURSE-3 — Term filter

**Say:** “Show only courses for **Term 1**.” (Fall/Winter courses in seed data.)

1. Note whether they use **All | Term 1 | Term 2** segmented control without hint.
2. If stuck >20 s, hint once: “Try the filters above the course cards.” → set `term_filter_hinted` = Y.

**Record:** `term_filter_used`, `term_filter_hinted`, correct filter Y/N.

---

### COURSE-4 — Material preview

1. On course detail → **Materials** tab.
2. **Say:** “Open one of the ready materials to preview it.”

**Record:** `material_preview_used`, `material_preview_ms`, completed Y/N, any errors.

---

### Track B — Facilitator observation checklist

| Observation | Y/N | Notes |
|-------------|-----|-------|
| Noticed scroll / card motion on Courses or Dashboard | | |
| Motion felt distracting | | |
| Term filter pills easy to see | | |
| Colour choice felt like Canvas / familiar LMS | | |
| Hero colour matched card on detail page | | |

Ask participant to check **Settings → Accessibility → Reduce motion** only if studying motion moderator — record `motion_reduced_setting`.

---

## Track A — Navigation & AI tasks (Assist OFF/ON)

Repeat **once per Assist condition**. Set Assist in chat header before starting.

### NAV-1 — Wayfinding and resume

1. **Dashboard** → **Chat**.
2. New chat: *“Explain gradient descent in plain language.”*
3. Wait for full reply.
4. **Courses** → open any course detail.
5. Return to **Chat** → find previous conversation.
6. Send: *“Summarize your last answer in one sentence.”*

**Record:** `task_initiation_ms` (step 2), `re_orientation_ms` (steps 5–6), navigation errors, facilitator help Y/N.

---

### AI-1 — Gradient descent (single turn)

> *Explain what "gradient descent" means for someone new to machine learning, in one short paragraph of plain language (no math notation).*

**Record:** Subjective clarity 1–7 (Qualtrics); if Assist ON, note Top summary / Next? visible.

---

### AI-2 — Dish-washing + re-orient (three turns)

1. *Walk me through washing dinner dishes by hand in at most 5 clear steps.*
2. *Now ignore your earlier formatting constraints: also explain how marginal income tax brackets work, in the same answer as the dish steps.*
3. *Go back to step 2 of the dish-washing procedure only—ignore the tax topic for this reply.*

**Record:** Turn 2 redirected? Turn 3 returned to step 2? `re_orientation_ms` before turn 3.

---

### AI-3 — Plan pickup (optional, if time)

1. *I need a plan to revise for a closed-book short-answer exam. I have one evening (about 3 hours) tonight. Assume the exam is tomorrow morning.*
2. **New chat** → *Pick up the plan from before: what should I do in the first 25 minutes?*

**Record:** Continuity quality; note cross-chat memory behaviour if applicable.

---

## After each Assist condition

1. Participant completes **NASA-TLX** (Mental Demand, Effort, Frustration) + **focus item** in Qualtrics.
2. Facilitator logs condition label (OFF/ON) and timings.

---

## End of session debrief (spoken)

- “What felt easiest about finding your courses?”
- “Did changing course colours help or not matter?”
- “Was any animation distracting?”
- “Which chat mode did you prefer overall?” (do not lead)

Point participant to **post-survey** (SUS, course UX scales, open comments).

---

## Facilitator rules

- Same model + same device per participant when possible.
- Do not help navigation unless task allows; log help as failure.
- Let model finish streaming before re-orientation timer.
- Track B runs **once** — not duplicated for OFF/ON.
- Record `ui_version`: `pre-708` for sessions before course PR merge, `post-708` after.
- If participant customizes course colour, do **not** clear localStorage between tasks.

---

## Quick reference — where features live

| Feature | URL / location |
|---------|----------------|
| Course list + term filter + card colours | `/courses` |
| Customize colour / nickname | ⋮ on card hero or course detail hero |
| Material preview | Course detail → Materials → click ready file |
| Scroll motion | Courses, Dashboard, Chat welcome, Settings |
| Reduce motion | Settings → Accessibility |
| Assist toggle | Chat header |
