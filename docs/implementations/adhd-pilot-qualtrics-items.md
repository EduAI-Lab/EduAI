# ADHD Assist Pilot — Qualtrics Survey Items

**Study:** H26-00906  
**Use with:** [adhd-pilot-facilitator-sheet.md](./adhd-pilot-facilitator-sheet.md)  
**Last updated:** 2026-06-22

This doc lists **what to add or keep** in Qualtrics for the post-#708 course UX work. Items are grouped into blocks. Use **7-point Likert** unless noted (1 = strongly disagree / not at all · 7 = strongly agree / very much).

---

## Survey structure (recommended block order)

1. **Consent & demographics** (pre-session or start)
2. **Course UX block** (after facilitator runs COURSE-1–4) — **NEW**
3. **NASA-TLX — Condition 1** (after first Assist block)
4. **NASA-TLX — Condition 2** (after second Assist block)
5. **Chat / Assist comparison** (existing — keep)
6. **SUS + global + debrief** (end)

Embed `participant_id` as hidden field or first question; match facilitator spreadsheet.

---

## Keep from existing Form A / P01 survey

Do **not** remove these — they remain your Track A core:

| Block | Items |
|-------|--------|
| Demographics | Age band, ADHD self-ID (per BREB), prior LMS use (Canvas/Moodle/etc.) |
| NASA-TLX | Mental Demand, Effort, Frustration (×2, one per Assist condition) |
| SUS | Standard 10-item SUS (end of session) |
| Assist comparison | Overall preference OFF vs ON; back-on-task after distraction; read/scan ease |
| Comprehension | Post AI-1 clarity (optional 1–7) |

---

## NEW — Block: Course UX (Track B)

**Intro text for block:**

> The next questions are about the **Courses** area of EduAI (course list, course pages, and materials). Answer based on what you just tried in the session.

### Discrimination & wayfinding

| ID | Question | Type |
|----|----------|------|
| **CU-1** | I could easily tell my courses apart on the course list. | Likert 1–7 |
| **CU-2** | I quickly found the course the facilitator asked me to open. | Likert 1–7 |
| **CU-3** | When I opened a course, it felt like the **same course** I saw on the list (colours/layout matched). | Likert 1–7 |

### Personalization (colour / nickname)

| ID | Question | Type |
|----|----------|------|
| **CU-4** | Changing the course colour/nickname was easy to find and use. | Likert 1–7 · display logic: only if customized OR show with NA |
| **CU-5** | Personalizing course colours helped me recognize my courses. | Likert 1–7 |
| **CU-6** | I would use course colour customization in a real semester. | Likert 1–7 |

**Alternative for CU-4 if they did not customize:**

| ID | Question | Type |
|----|----------|------|
| **CU-4b** | I noticed that courses could be customized (colour/nickname). | Yes / No / Did not look |

### Term filter

| ID | Question | Type |
|----|----------|------|
| **CU-7** | The Term 1 / Term 2 filter was easy to notice and use. | Likert 1–7 |
| **CU-8** | Filtering courses by term reduced clutter or mental effort. | Likert 1–7 |

### Material preview

| ID | Question | Type |
|----|----------|------|
| **CU-9** | Previewing course materials inside EduAI was useful. | Likert 1–7 |
| **CU-10** | I could read enough of the material without downloading a file. | Likert 1–7 |

### Motion & calm (ADHD-relevant)

| ID | Question | Type |
|----|----------|------|
| **CU-11** | Animations or movement on the page felt **distracting**. | Likert 1–7 (reverse-scored for “calm”) |
| **CU-12** | The interface felt calm and not overwhelming on the Courses page. | Likert 1–7 |
| **CU-13** | I have **Reduce motion** turned on in Settings → Accessibility. | Yes / No / Don't know |

### Optional single items (pick 2–3 max to limit length)

| ID | Question | Type |
|----|----------|------|
| **CU-14** | The course page design felt familiar (similar to other tools I use, e.g. Canvas). | Likert 1–7 |
| **CU-15** | I knew what to do next when browsing courses. | Likert 1–7 |

---

## NEW — Hidden / metadata fields (facilitator or URL params)

Add as hidden questions or manual entry for analysis:

| Field | Values |
|-------|--------|
| `participant_id` | P01, P02, … |
| `ui_version` | pre-708 / post-708 |
| `session_date` | ISO date |
| `assist_order` | OFF_then_ON / ON_then_OFF |
| `customized_course` | Y/N (facilitator can set via embedded data) |

---

## NEW — Open-ended (end of Course UX block)

| ID | Prompt |
|----|--------|
| **CU-O1** | What, if anything, helped you find or recognize courses? |
| **CU-O2** | Was anything confusing or distracting on the Courses page? |

---

## Analysis notes (for your thesis / report)

| Construct | Primary items | Compare |
|-----------|---------------|---------|
| Visual discrimination | CU-1, CU-2 | Pre vs post-708 cohorts, or vs P01 baseline |
| Personalization value | CU-5, CU-6 | Customizers vs non-customizers |
| Cognitive load (courses only) | CU-8, CU-12, NASA-TLX Frustration | Track B vs Track A |
| Motion moderator | CU-11, CU-13 | Reduce motion ON vs OFF subgroups |
| Material access | CU-9, CU-10 | Task completion + preview time from facilitator sheet |

**Important:** Course UX items measure **Track B**. Do not attribute differences to Assist ON/OFF unless you run a factorial design. Report Assist and Course UX as separate result sections.

---

## Minimum viable add (if survey length is a concern)

If you can only add **5 questions**, use:

1. CU-1 (tell courses apart)  
2. CU-3 (inside/outside match)  
3. CU-5 (personalization helped)  
4. CU-11 (motion distracting — reverse)  
5. CU-O1 (open-ended help)

Plus hidden `ui_version` and facilitator timings for COURSE-1.
