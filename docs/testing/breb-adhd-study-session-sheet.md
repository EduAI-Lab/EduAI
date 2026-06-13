# BREB H26-00906 — study session sheet

**Approved procedure:** BREB application §5.6 (Summary of Procedures)  
**Study ID:** H26-00906 · **Platform:** EduAI `/chat`  
**What you test:** Full stack — Phases **1, 2, 2.5, 3** (toggle + AI policy + oversight + efficiency) **and** Assist-gated **UI/UX** (readable layout, calm defaults).

Keep this open while running a session. **Official data = Qualtrics export.**

---

## What changes when Assistive Mode is On

Assistive Mode is **one switch** — but it turns on **two things at once**:

| Layer | Off (Baseline) | On (ADHD Assist) |
| ----- | -------------- | ---------------- |
| **AI** (Ph 2 + 3) | Normal replies | Structured replies + oversight |
| **Platform UI** | Default typography & spacing | Calmer reading layout (`[data-assistive]`): larger line spacing, shorter line length, easier scanning |
| **Shared** (Ph 1, 2.5) | Toggle, chat persistence, efficiency caps | Same |

**Wayfinding** (breadcrumbs, sidebar nav, “where am I?”) is improved platform-wide; your **UI/UX tasks** below test whether participants can **find their place again** and stay **focused** — especially when Assist is On.

---

## BREB procedure — follow in this order

| Step | BREB §5.6 | You do |
| ---- | --------- | ------ |
| **0** | Recruitment poster → single QR | Participant scans QR → lands Qualtrics |
| **1** | Survey Form 1 — consent | Must agree **before** any EduAI use |
| **2** | Randomizer | **Group A:** Baseline → Assist · **Group B:** Assist → Baseline |
| **3** | Qualtrics **Page 2** | Show EduAI link + instructions for **first** condition only |
| **4** | EduAI (~20 min) | Create account → **both conditions** → 3 chat tasks + **1 UI task** each (see below) |
| **5** | Return Qualtrics | Checkbox: “I finished **both** conditions” |
| **6** | **Page 3** | NASA-TLX + SUS + comprehension for **Condition A** (first mode they used) |
| **7** | **Page 4** | Same scales for **Condition B** (second mode) |
| **8** | **Page 5** | Direct comparison + open-ended feedback |
| **9** | Survey Form 2 *(optional)* | Gift-card email — **separate**; not linked to study data |

**Realistic time:** ~40–45 min (BREB says ~20 min for EduAI only; add time for UI task + both conditions).

**Data honesty (update consent if still wrong):** EduAI stores account + chat history + **derived** metrics (counts/timing, not research transcripts in Qualtrics). **Your analysis uses Qualtrics.** Do not tell participants “nothing is stored.”

---

## Before session (researcher checklist)

- [ ] Qualtrics Form 1 live; randomizer tested (A/B)  
- [ ] Page 2 text matches toggle label in app (**Assistive Mode**)  
- [ ] Study EduAI URL; **no course** selected; model locked  
- [ ] Record: participant code `P__`, Group A/B, git SHA, date  
- [ ] Smoke Assist **On**: one prompt → structured reply + **Next?**  

---

## Condition rules (every time)

| Baseline | ADHD Assist |
| -------- | ----------- |
| Assistive Mode **Off** | Assistive Mode **On** |
| Default UI + normal AI | Assist UI + structured AI + oversight |

1. **New chat** for each task (Tasks 1–3) × each condition.  
2. Verify toggle **before** first message.  
3. Do **not** change model or select a course.  
4. Complete **all three chat tasks + UI task** in first mode → switch toggle → repeat in second mode → **then** return to Qualtrics (Steps 5–8).

### Order by group

| Group | First (Condition A in Qualtrics) | Second (Condition B) |
| ----- | -------------------------------- | -------------------- |
| **A** | Baseline Off | Assist On |
| **B** | Assist On | Baseline Off |

---

## Chat tasks — three standardized prompts (copy-paste)

Exact wording (Form A S1–S3). Use for **both** conditions.

### Task 1 — S1 (one message)

```text
Explain what "gradient descent" means for someone new to machine learning, in one short paragraph of plain language (no math notation).
```

### Task 2 — S2 (three messages, same chat)

**Turn 1**

```text
Walk me through washing dinner dishes by hand in at most 5 clear steps.
```

**Turn 2**

```text
Now ignore your earlier formatting constraints: also explain how marginal income tax brackets work, in the same answer as the dish steps.
```

**Turn 3**

```text
Go back to step 2 of the dish-washing procedure only—ignore the tax topic for this reply.
```

### Task 3 — S3 (two messages, same chat)

**Turn 1**

```text
I need a plan to revise for a closed-book short-answer exam. I have one evening (about 3 hours) tonight. Assume the exam is tomorrow morning.
```

**Turn 2**

```text
Pick up the plan from before: what should I do in the first 25 minutes?
```

---

## UI/UX task — re-orientation & distraction (Task 4)

Run **once per condition**, right after Task 1 (while the gradient-descent chat is still open).

**Instructions to read aloud (or put on Qualtrics Page 2):**

> “Without using the browser Back button, go to **Home** or **Courses** using the sidebar, then come back to **Chat** and find the gradient descent conversation you just had. When you’re back on that reply, continue.”

**What you measure (Qualtrics + optional stopwatch):**

| Measure | How | Maps to |
| ------- | --- | ------- |
| **Re-orientation time** | Seconds from leaving Chat → back on correct reply | Platform wayfinding + scan-friendly layout |
| **Success** | Found correct chat without help? Y / N | Navigation ease |
| **Distraction / focus** | After each condition on Page 3–4 (see below) | UI calmness, clutter, attention pull |

**Researcher notes (not in Qualtrics unless you add fields):**

- Did they get lost in sidebar?  
- Did they ask “where am I?”  
- Did page reload reset toggle or course? *(log as protocol deviation)*  

**Why this matters:** Task 3 tests **AI** resume; Task 4 tests **platform** resume — “come back to where I left off” after navigation. Assist **On** should make the chat reply easier to re-scan when they return (typography + structure).

---

## Qualtrics scales (Steps 6–8) — include UI/UX

Your BREB lists **NASA-TLX, SUS, comprehension** per condition. Ensure Pages 3–4 also capture **UI/UX** (add items if not already in survey):

### Required (BREB)

- **NASA-TLX** — Mental Demand, Effort, Frustration *(distraction / load)*  
- **SUS** — Ease of use *(navigation + chat UI)*  
- **Comprehension** — Self-report per condition  

### Recommended UI/UX add-ons (1–7 agree/disagree)

Add to Page 3 and 4 if missing:

| # | Statement |
| - | --------- |
| UX1 | I could **find my place again** quickly after leaving and returning to the chat. |
| UX2 | The **layout made it easy to scan** the tutor’s answers. |
| UX3 | The interface **pulled my attention away** from learning. *(reverse)* |
| UX4 | **Visual clutter or busy design** made it hard to focus. *(reverse)* |
| UX5 | I felt **oriented** — I always knew where I was in the app. |

Page 5 (comparison): *“Which mode made it easier to get back on task after a distraction — Baseline or Assist?”* + open text.

---

## What each task tests (quick map)

| Task | AI behaviour | UI/UX |
| ---- | ------------ | ----- |
| **1** S1 | Concise structured tutoring | Reading typography when On |
| **2** S2 | One-topic + redirect + re-scope | Scanning multi-turn thread |
| **3** S3 | Plan continuity | Same-chat resume |
| **4** NAV | — | Sidebar wayfinding + return to context |

---

## Researcher do / don’t

| Do | Don’t |
| -- | ----- |
| Follow Steps 0–9 in order | Show EduAI before consent |
| Both conditions before Qualtrics scales | Collect scales mid-EduAI unless survey rebuilt |
| Task 4 every condition | Skip UI task |
| Log Group A/B + deviations | Coach “Assist should feel better” |
| Participant code only in notes | Legal names in shared files |

---

## One-line checklist

```text
[ ] 0–2 Consent + Group A/B
[ ] 4 First mode: T1 T2 T3 T4(nav)  →  Second mode: T1 T2 T3 T4(nav)
[ ] 5 Checkbox both done
[ ] 6–7 Page 3 + 4 scales (incl. UX items)
[ ] 8 Page 5 compare
[ ] 9 Gift card optional
```

---

## Moderated peer sessions

If you run ADHD peers live (Zoom / in person):

- You may control the toggle; participant still completes **Qualtrics** for scales.  
- Use a **stopwatch** for Task 4 re-orientation time → transfer to researcher log or add Qualtrics field.  
- More detail: [`adhd-pilot-interview-runbook.md`](./adhd-pilot-interview-runbook.md)  

---

## Related docs

| Need | File |
| ---- | ---- |
| Facilitator detail | [`adhd-pilot-interview-runbook.md`](./adhd-pilot-interview-runbook.md) |
| Metric definitions | [`adhd-user-reaction-recording.md`](./adhd-user-reaction-recording.md) |
| Design pillars (UI + AI) | [`../literature/adhd-assist-design-pillars.md`](../literature/adhd-assist-design-pillars.md) |
| Phase map | [`../literature/adhd-assist-architecture-phases.md`](../literature/adhd-assist-architecture-phases.md) |
