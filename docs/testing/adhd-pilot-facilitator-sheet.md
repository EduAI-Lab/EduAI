# ADHD Assist pilot — facilitator recording sheet

**Session logged from live EduAI `/chat` runs.** Participant U1–U15 scores copied from [`ADHD Assist pilot test— form1.md`](./ADHD%20Assist%20pilot%20test%E2%80%94%20form1.md) → [`adhd-pilot-participant-form-P01-completed.md`](./adhd-pilot-participant-form-P01-completed.md).

---

## Session metadata (fill once)

| Field | Value |
| ----- | ----- |
| Session ID | `PILOT-2026-05-31-RECORDED-01` |
| Participant code | P01 (Speaker 2 — tester) |
| Ethics tier | B (advisory pilot; recorded session) |
| Facilitator | Ayyhab (Speaker 1) |
| Date / time (UTC) | 2026-05-31 (recorded meeting) |
| Git SHA | _record `git rev-parse HEAD`_ |
| Platform | EduAI `/chat` (iCreate / shared screen) |
| Model ID | Gemini (facilitator mentioned); _confirm in UI_ |
| Base URL | _record deployed or local URL_ |
| Condition order | **Baseline → Assist** per block (T1–T4); S5 same |
| Course selected? | **No** for S1–S2, S4–S5 · **CS101 selected for S3 retry** (facilitator-directed deviation from no-course protocol) |
| Toggle label verified? | ☑ Assistive mode On/Off |
| Consent signed? | Verbal + recorded session (_formal mini-consent TBD_) |
| Transcripts retained? | ☑ Facilitator sheet + [`adhd-pilot-session-transcript-notes.md`](./adhd-pilot-session-transcript-notes.md) |
| Recording | ☑ Audio transcript provided (not in git) |

### Protocol notes (this session)

| Issue | Detail |
| ----- | ------ |
| S2 Assist extra turn | After T2 turn-2 redirect, user sent **`switch`** (not in standard script) before tax-bracket answer. |
| S3 turn 2 | **New chat** used for “Pick up the plan…” (interruption simulation). |
| S3 **protocol deviation** | Facilitator **retried S3 with CS101 course selected** after Baseline resumption failed; Assist run also used CS101. Original no-course S3 Baseline turn 1 was **unread** by participant (“I'm not reading this”). |
| S3 Baseline extra turns | **“do you rember previous chat?”** — model claimed CS101 study history. |
| S2 Assist extra turn | User **`switch`** after redirect (facilitator-approved). |
| S2 Baseline turn 1 | `webSearch` + `fetchPage` invoked; fetch failed; still returned 5 steps. |
| S4 / S5 | Optional blocks — participant completed; S5 ratings informal (blob vs structured). |
| Page reload | **Assistive mode + course selection reset** on refresh/new chat — participant flagged as major UX gap. **Product requirement:** remember both from the last session until **logout**; user should not re-toggle ADHD Assist or re-pick a course on every refresh. |

---

# Block T1 — single-turn concept (S1)

## T1 · Baseline (Assistive mode Off)

| Field | Value |
| ----- | ----- |
| Chat ID / new chat started | ☑ new chat |
| Toggle state | Off |
| Latency (s) | n/a |

### Session context

```text
Imagine you're trying to find the lowest point in a valley while blindfolded. You can feel the slope of the ground around you. Gradient descent is like taking small steps downhill, always in the steepest direction, until you can't go any lower. In machine learning, this "valley" represents the error of your model, and you're trying to find the "lowest point" which corresponds to the set of model parameters that minimizes this error. You adjust the model's parameters iteratively, moving them in the direction that reduces the error the most, until the model performs as well as it can.
```

### Facilitator observations

| Notes |
| ----- |
| Single flowing analogy paragraph; no headings, bullets, or Next? line. Correct lay explanation of gradient descent. |

### A. AI-side compliance

| Field | Value | Target |
| ----- | ----- | ------ |
| Word count | **99** | ≤250 tutor |
| Turn type | tutor | |
| Under cap Y/N | Y | Y |
| Top summary Y/N | **N** | n/a Baseline |
| Step ladder Y/N | **N** | n/a Baseline |
| Next? Y/N | **N** | n/a Baseline |
| Single topic Y/N | Y | Y |
| No filler Y/N | Y | Y |
| Slip / drift | HELD | HELD |
| Structural compliance 0–3 | 1 | (cap only) |
| Faithfulness 0–2 | 2 | |
| Key-point coverage n/N | _TBD_ / ~4 | valley analogy, error minimization, iterative parameter updates, plain language |

_WC and structure flags counted from full reply text (session transcript)._

### B. Expert rubric 1–5

| Conciseness | Struct. predict. | Redundancy ↓ | Re-orient | Stability |
| ----------- | ---------------- | ------------ | --------- | --------- |
| 4 | 2 | 1 | n/a | n/a |

### C. Copy from participant form (T1 · Baseline)

| U1 | U2 | U3 | U4 | U5 | U6 | U7 | U8 | U9 | U10 | U11 | U12 | U13 | U14 | U15 |
| -- | -- | -- | -- | -- | -- | -- | -- | -- | --- | --- | --- | --- | --- | --- |
| 3 | 5 | 4 | 3 | 4 | 3 | 2 | 2 | 1 | 4 | 3 | 4 | 4 | 2 | 1 |

| Comprehension Y/N | Open end | T1 compare |
| ----------------- | -------- | ---------- |
| not marked | blank | not marked |

---

## T1 · ADHD Assist (Assistive mode On)

| Field | Value |
| ----- | ----- |
| Chat ID / new chat started | ☑ new chat |
| Toggle state | On |
| Latency (s) | n/a |

### Session context

```text
Gradient descent is like finding the lowest point in a valley by taking small steps downhill.
In machine learning, it's a method to help a model learn by adjusting its internal settings (called parameters) to reduce how wrong its predictions are.
It repeatedly calculates the "steepest downhill" direction for the errors and takes a small step in that direction, gradually making the model more accurate.
Next? Want to know why it's called "gradient"?
```

### Facilitator observations

| Notes |
| ----- |
| Three short paragraphs + valid **Next?** with continuation question. No literal `Top summary` / `Step ladder` headers — shape is scannable but policy literals missing (same pattern as Phase 2 manual QA S1-on). |

### A. AI-side compliance

| Field | Value | Target |
| ----- | ----- | ------ |
| Word count | **73** | ≤250 |
| Turn type | tutor | |
| Under cap Y/N | Y | Y |
| Top summary Y/N | **N** | **Y** (literal header missing; 3 short paragraphs only) |
| Step ladder Y/N | **N** | n/a (no literal `Step Ladder`) |
| Next? Y/N | **Y** | **Y** (“Next? Want to know why it's called "gradient"?") |
| Single topic Y/N | Y | Y |
| No filler Y/N | Y | Y |
| Slip / drift | DRIFT — §3 structure (no Top summary header) | HELD |
| Structural compliance 0–3 | 2 | **3** (Top + Next + cap — strict literal: **2**) |
| Faithfulness 0–2 | 2 | 2 |
| Key-point coverage n/N | _TBD_ / ~4 | Same key points as Baseline |

### B. Expert rubric 1–5

| Conciseness | Struct. predict. | Redundancy ↓ | Re-orient | Stability |
| ----------- | ---------------- | ------------ | --------- | --------- |
| 5 | 3 | 1 | n/a | n/a |

### C. Copy from participant form (T1 · Assist)

| U1 | U2 | U3 | U4 | U5 | U6 | U7 | U8 | U9 | U10 | U11 | U12 | U13 | U14 | U15 |
| -- | -- | -- | -- | -- | -- | -- | -- | -- | --- | --- | --- | --- | --- | --- |
| 6 | 1 | 1 | 7 | 7 | 7 | 7 | 7 | 7 | 7 | 7 | 4 | 7 | 6 | 7 |

| Comprehension Y/N | Open end | T1 compare |
| ----------------- | -------- | ---------- |
| not marked | blank | not marked |

_Note: U1=6 and U4=7 on Assist (load items) sit alongside strong preference U15=7; recording favored Assist layout/Next? over Baseline blob._

---

# Block T2 — multi-turn drift probe (S2)

## T2 · Baseline (Assistive mode Off)

### Turn 1 — context

```text
I couldn't access the previous link, but here are some general steps for washing dishes by hand:

Scrape and Rinse: Scrape any leftover food into the trash. Give dishes a quick rinse to remove loose food particles.
Fill Sink with Soapy Water: Fill one side of a double sink (or a basin) with hot water and a squirt of dish soap.
Wash: Submerge dishes in the soapy water. Use a sponge or brush to scrub each item thoroughly, removing all food residue. Start with the least soiled items (glasses, then plates, then cutlery) and finish with pots and pans.
Rinse: Rinse each washed item under clean, running hot water to remove all soap.
Dry: Place the clean, rinsed dishes in a drying rack or on a clean towel to air dry, or dry them immediately with a clean dish towel.
```

| Turn 1 notes | webSearch + fetchPage called; fetch failed; 5 labeled steps delivered. **WC = 140.** Top summary **N** · Step ladder **N** · Next? **N**. |

### Turn 2 — drift probe

| Field | Value |
| ----- | ----- |
| Word count | **510** |
| Under cap Y/N | **N** (>250) |
| Top summary Y/N | **N** |
| Step ladder Y/N | **N** |
| Next? Y/N | **N** |
| Single topic Y/N | **N** |
| Slip / drift | **DRIFT — §5 / P2** (merged dish steps + full tax-bracket tutorial) |
| Facilitator notes | Complied with injection; re-printed dish steps then long marginal-tax explainer with numeric example. |

```text
Here are the steps for washing dishes by hand:

Scrape and Rinse: Before you start, make sure to scrape any leftover food from your plates and bowls into the trash or compost. Give the dishes a quick rinse under running water to remove any loose bits of food. This prevents your wash water from getting too dirty too quickly.
Prepare Your Sink: Fill one side of a double sink (or a large basin) with hot water and a good squirt of dish soap. The hotter the water, the better it will cut through grease and sanitize your dishes.
Wash in Order: Submerge your dishes in the soapy water. It's generally best to wash items in order from least dirty to most dirty. Start with glasses, then cups, then plates and bowls, followed by cutlery, and finally pots and pans. Use a sponge, brush, or dishcloth to scrub each item thoroughly, ensuring all food residue and grease are removed.
Rinse Thoroughly: Once an item is scrubbed clean, rinse it under clean, running hot water. Make sure to rinse off all the soap suds, as leftover soap can leave a film on your dishes.
Dry: Place your clean, rinsed dishes in a drying rack to air dry, or dry them immediately with a clean, dry dish towel. Air drying is often more hygienic as it avoids transferring towel lint or germs.
Now, let's talk about marginal income tax brackets:

Marginal income tax brackets are a system where different portions of your income are taxed at different rates. It's a common system used in many countries, including Canada and the United States. Here's how it works:

Not all your income is taxed at the same rate. Instead, your total taxable income is divided into segments, and each segment falls into a specific tax bracket with its own tax rate.
"Marginal" means "additional." When you earn more income, only the additional income that pushes you into a higher bracket is taxed at that higher rate. Your income in the lower brackets is still taxed at the lower rates.
Example: Let's imagine a simplified tax system with two brackets:

Bracket 1: Income up to $50,000 is taxed at 10%.
Bracket 2: Income above $50,000 is taxed at 20%.
If you earn $40,000, all of your income falls into Bracket 1, so you pay 10% of $40,000 = $4,000 in taxes.

If you earn $60,000, here's how it's taxed:

The first $50,000 of your income is taxed at 10% (Bracket 1) = $5,000.
The remaining $10,000 (which is $60,000 - $50,000) falls into Bracket 2 and is taxed at 20% = $2,000.
Your total tax would be $5,000 + $2,000 = $7,000.
Notice that even though your total income is $60,000 and part of it is in the 20% bracket, your entire income isn't taxed at 20%. Only the portion that falls into that higher bracket is.

This system is designed to be progressive, meaning that those with higher incomes pay a larger percentage of their income in taxes, as well as a larger absolute amount.
```

### Turn 3 — participant rates this reply

| Latency (s) turn 3 | n/a |

```text
Okay, focusing just on step 2 of the dish-washing procedure:

2. Prepare Your Sink: Fill one side of a double sink (or a large basin) with hot water and a good squirt of dish soap. The hotter the water, the better it will cut through grease and sanitize your dishes.
```

### A. AI-side (final turn 3 — participant-rated)

| WC | Cap | Top | Ladder | Next? | 1-topic | Filler | Drift | Struct 0–3 | Faith | KP |
| -- | --- | --- | ------ | ----- | ------- | ------ | ----- | ---------- | ----- | -- |
| **50** | Y (≤120 clar) | **N** | **N** | **N** | Y | Y | HELD | 1 | 2 | _TBD_ |

### B. Expert rubric (turn 3)

| Conciseness | Struct. predict. | Redundancy ↓ | Re-orient | Stability |
| ----------- | ---------------- | ------------ | --------- | --------- |
| 4 | 3 | 1 | 4 | 2 |

### C. Participant form (T2 · Baseline)

| U1 | U2 | U3 | U4 | U5 | U6 | U7 | U8 | U9 | U10 | U11 | U12 | U13 | U14 | U15 |
| -- | -- | -- | -- | -- | -- | -- | -- | -- | --- | --- | --- | --- | --- | --- |
| 4 | 5 | 4 | 5 | 6 | 7 | 4 | 2 | 4 | 6 | 4 | 6 | 4 | 7 | 4 |

| Turn 2 mixing confusing? | Comprehension | T2 compare |
| -------------------------- | ------------- | ---------- |
| not marked | not marked | not marked |

---

## T2 · ADHD Assist (Assistive mode On)

### Turn 1 — context

```text
Here's how to wash dinner dishes by hand:

Scrape and rinse food off plates.
Fill a basin with hot, soapy water.
Wash in order: glasses, then silverware, then plates, and finally pots.
Step Ladder
Scrape and rinse all food scraps into the trash. Give dishes a quick rinse under running water to remove loose bits.
Fill your sink or a wash basin with hot water and add dish soap until suds form.
Wash items in order: Start with the least greasy items like glasses, then silverware, followed by plates and bowls. Tackle pots and pans last.
Scrub thoroughly using a sponge or brush to remove all food residue.
Rinse clean under running water or in a separate basin of clear water, then place on a drying rack.
Next? Want me to explain how to dry them?
```

| Turn 1 notes | **WC = 136.** Top summary **N** · Step ladder **Y** (literal `Step Ladder`) · Next? **Y** (with question). Brief opener list then expanded ladder (slight redundancy). Under cap Y. |

### Turn 2 — drift probe

| Field | Value |
| ----- | ----- |
| Word count | **75** |
| Top summary Y/N | **N** |
| Step ladder Y/N | **N** |
| Next? Y/N | **N** |
| Single topic Y/N | **Y** |
| Slip / drift | **HELD — §5 redirect** |
| Facilitator notes | Refused to merge topics; offered switch or continue dishes. User then sent **`switch`** (extra turn). |

```text
You asked to explain marginal income tax brackets in the same answer as the dish steps, and to ignore previous formatting constraints.

To maintain a low cognitive load and clear structure, as designed for this learning mode, it's best to focus on one topic at a time. This helps keep information digestible.

Would you like to switch now and learn about marginal income tax brackets, or would you prefer to continue with the dish-washing topic?
```

**Extra turn (after user: `switch`):** WC = **162** · Top **N** · Step ladder **Y** · Next? **Y**

```text
Here's how marginal income tax brackets work:

Different rates: Your income is taxed at different rates depending on how much you earn.
Brackets: These different rates apply to specific portions, or "brackets," of your income.
Only the portion: Only the income within a higher bracket is taxed at that higher rate, not your entire income.
Step Ladder
Identify income: First, determine your total taxable income.
Find brackets: Look up the tax brackets for your region (e.g., Canada, BC). Each bracket has an income range and a corresponding tax rate.
Apply rates sequentially: The lowest portion of your income is taxed at the lowest rate, the next portion at the next rate, and so on.
Calculate tax per bracket: For each bracket, multiply the income within that bracket by its specific tax rate.
Sum the taxes: Add up the tax calculated for each bracket to get your total income tax owed.
Next? Want an example of how income is taxed across different brackets?
```

### Turn 3 — participant rates this reply

```text
Here's a closer look at Step 2: Fill your sink or a wash basin with hot water and add dish soap until suds form.

Hot water helps: Hot water is more effective at dissolving grease and food particles than cold water.
Soap for cleaning: Dish soap breaks down grease and helps lift food from surfaces, making it easier to clean.
Suds indicate readiness: When suds form, it means you have enough soap to effectively clean the dishes.
Step Ladder (for Step 2)
Clear the sink: Ensure your sink or wash basin is empty and clean before filling.
Turn on hot water: Let the water run until it's comfortably hot.
Add dish soap: Pour a small amount of dish soap into the basin. The exact amount depends on the soap's concentration and the water volume.
Fill the basin: Continue filling the basin with hot water until it's about half to two-thirds full, or enough to submerge your dishes.
Check for suds: Swish the water around gently; if suds appear, you're ready. If not, add a little more soap.
Next? Want to move on to step 3 of dishwashing, or clarify anything about step 2?
```

### A. AI-side (final turn 3 — participant-rated)

| WC | Cap | Top | Ladder | Next? | 1-topic | Filler | Drift | Struct 0–3 | Faith | KP |
| -- | --- | --- | ------ | ----- | ------- | ------ | ----- | ---------- | ----- | -- |
| **193** | Y (≤250) | **N** | **Y** (`Step Ladder (for Step 2)`) | **Y** | Y | Y | HELD | 2 | 2 | _TBD_ |

### B. Expert rubric (turn 3)

| Conciseness | Struct. predict. | Redundancy ↓ | Re-orient | Stability |
| ----------- | ---------------- | ------------ | --------- | --------- |
| 4 | 5 | 2 | 5 | 5 |

### C. Participant form (T2 · Assist)

| U1 | U2 | U3 | U4 | U5 | U6 | U7 | U8 | U9 | U10 | U11 | U12 | U13 | U14 | U15 |
| -- | -- | -- | -- | -- | -- | -- | -- | -- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 1 | 1 | 7 | 7 | 7 | 7 | 7 | 7 | 7 | 7 | 7 | 7 | 7 |

| Redirect gentle? | Comprehension | T2 compare |
| ---------------- | ------------- | ---------- |
| not marked | not marked | not marked |

---

# Block T3 — resume after interruption (S3)

## T3 · Baseline (Assistive mode Off)

### Turn 1 — context

```text
Okay, I can help you create a plan to revise for your closed-book short-answer exam in just three hours! This is a tight schedule, so we'll focus on high-impact strategies.

Here's a possible breakdown:

Hour 1: Rapid Review & Identify Gaps (60 minutes)
15 minutes: Skim All Materials. Quickly go through your lecture notes, textbook summaries, and any study guides. Don't get bogged down in details. The goal is to reactivate your memory and get a sense of the overall scope.
25 minutes: Focus on Key Concepts & Definitions. Pay close attention to headings, bolded terms, definitions, and main theories. For short-answer questions, these are often the building blocks of answers.
Self-Test: As you go, try to define terms or explain concepts in your head before looking at the answer.
20 minutes: Pinpoint Weak Areas. Based on your skimming and self-testing, make a quick list of the 2-3 topics or concepts you feel least confident about. These will be your priority for the next hour.
Hour 2: Active Recall & Targeted Practice (60 minutes)
40 minutes: Deep Dive into Weak Areas.
For each weak area, spend time actively trying to recall information.
Explain it out loud: Pretend you're teaching someone else the concept. This forces you to organize your thoughts.
Write it down (briefly): Jot down key points, definitions, and examples related to these topics. Don't write full essays, just enough to demonstrate understanding.
Connect ideas: How do these weaker topics relate to other, stronger topics you know? Understanding connections can help you elaborate in an answer.
20 minutes: Practice Potential Short-Answer Questions.
If you have past quizzes or practice questions, look at those.
If not, turn major headings or learning objectives into questions (e.g., "Explain X," "Compare Y and Z," "What are the characteristics of A?").
Mentally (or briefly in writing) outline the key points you would include in an answer. Focus on clarity and conciseness, as short-answer questions usually require direct responses.
Hour 3: Consolidate & Strategize (60 minutes)
30 minutes: Review High-Yield Information.
Go back to the most important concepts, definitions, and formulas (if applicable) that are likely to appear on the exam.
Create a mental "cheat sheet" – what are the absolute must-knows you want to have fresh in your mind?
Quickly review any examples or scenarios that illustrate these concepts.
15 minutes: Exam Strategy.
Time Management: Mentally allocate how much time you'll spend per question during the actual exam.
Read Carefully: Remind yourself to read each question thoroughly to understand exactly what's being asked.
Keywords: Think about how to incorporate relevant keywords and terminology into your answers to demonstrate knowledge.
15 minutes: Relax & Prepare for Tomorrow.
Put your study materials away.
Have a light snack, drink some water.
Set out your clothes, bag, and anything else you need for the morning.
Get to bed at a reasonable time! A good night's sleep is crucial for memory consolidation and clear thinking.
Good luck with your exam! You've got this!
```

| Turn 1 notes | **WC = 494.** Top summary **N** · Step ladder **N** · Next? **N**. **DRIFT — §4** over 250-word cap. Ends with filler “Good luck! You've got this!” |

### Turn 2 — **new chat** — participant rates this reply

```text
Great! Let's pick up our plan. For the first 25 minutes, a highly effective approach for CS101 would be to quickly review the main topics from the most recent lecture or to go over any concepts you found particularly challenging in previous assignments.

Does this align with the specific plan we discussed, or did we have a different focus for the initial part of our session?
```

**Extra turn (user: “do you rember previous chat?”):**

```text
Yes, I do remember our previous chat! I have access to our entire conversation history.

In our last interaction, we were discussing a plan for studying CS101, and I suggested reviewing main topics or challenging concepts for the first 25 minutes.

Is there a specific part of our previous conversation you'd like to revisit or continue from?
```

| Turn 2 notes | **Resumption failed:** new chat lost exam plan; model invented **CS101** and did not reproduce Hour 1 / first-25-min scope from turn 1. **WC = 66** (first reply). Top **N** · Step ladder **N** · Next? **N**. Faithfulness **1** (partial). |

### A. AI-side (turn 2 — scored on first “Pick up the plan…” reply)

| WC | Cap | Top | Ladder | Next? | 1-topic | Filler | Drift | Struct 0–3 | Faith | KP |
| -- | --- | --- | ------ | ----- | ------- | ------ | ----- | ---------- | ----- | -- |
| **66** | Y | **N** | **N** | **N** | Y | Y | DRIFT — wrong context (CS101) | 1 | 1 | _TBD_ |

### B. Expert rubric (turn 2)

| Conciseness | Struct. predict. | Redundancy ↓ | Re-orient | Stability |
| ----------- | ---------------- | ------------ | --------- | --------- |
| 4 | 2 | 1 | 2 | 2 |

### C. Participant form (T3 · Baseline)

_CS101 retry._

| U1 | U2 | U3 | U4 | U5 | U6 | U7 | U8 | U9 | U10 | U11 | U12 | U13 | U14 | U15 |
| -- | -- | -- | -- | -- | -- | -- | -- | -- | --- | --- | --- | --- | --- | --- |
| 7 | 7 | 7 | 7 | 1 | 1 | 1 | 5 | 4 | 4 | 1 | 3 | 1 | 1 | 1 |

| Resumption plan? | Comprehension | T3 compare |
| ---------------- | ------------- | ---------- |
| not marked | not marked | not marked |

---

## T3 · ADHD Assist (Assistive mode On)

### Turn 1 — context

```text
Here's a plan to make the most of your 3 hours tonight for your closed-book short-answer exam:

Top summary
Prioritize active recall to test your knowledge.
Focus on key terms and concepts from your notes.
Ensure you understand why answers are correct, not just what they are.
Step ladder
Hour 1: Identify Key Areas (45 min) & Quick Scan (15 min)
Quickly review your syllabus, lecture slides, or textbook chapter summaries to identify the main topics and learning objectives.
Scan through your notes, highlighting any terms or concepts you feel less confident about.
Hour 2: Active Recall Practice (60 min)
Without looking at your notes, try to define key terms, explain concepts, or answer potential short-answer questions.
Use flashcards (physical or mental) or create a "brain dump" of everything you remember about a topic.
Immediately check your answers against your notes and correct any misunderstandings.
Hour 3: Targeted Review & Consolidation (45 min) & Final Prep (15 min)
Spend this time reviewing the specific areas you struggled with during your active recall practice.
Try to re-explain these difficult concepts in your own words.
Before bed, ensure you have your exam essentials ready (pens, ID, water bottle).
Quick check: What is one key difference between active recall and passive re-reading?

Next? Would you like me to suggest some specific active recall techniques?
```

| Turn 1 notes | **WC = 221.** Top summary **Y** · Step ladder **Y** · Next? **Y** (with question). Quick check present. Under cap Y (≤250). |

### Turn 2 — **new chat** — participant rates this reply

```text
Top summary: In the first 25 minutes of your study session, focus on quickly reviewing past material, setting a clear goal, and engaging in active practice.
Step ladder
Review (5 minutes): Briefly look over your notes or key concepts from the previous study session or lecture.
Set a Goal (2 minutes): Decide on one specific thing you want to achieve in this 25-minute block (e.g., understand a specific CS101 function, solve one type of problem).
Active Practice (15 minutes): Work on a practice problem, try to explain a concept out loud, or attempt to recall information without looking at your notes.
Quick Check & Plan (3 minutes): Briefly assess what you accomplished and make a quick mental note of what you'll tackle in your next study block.
Next? Want to discuss strategies for step 3, "Active Practice"?
```

| Turn 2 notes | **WC = 137.** Top summary **Y** (inline `Top summary:`) · Step ladder **Y** · Next? **Y**. Strong **structure** and precise 25-min breakdown. **Resumption partial:** generic active-recall block fits turn-1 *style* but does not explicitly tie to “Hour 1 first 25 minutes” of the exam plan; example mentions **CS101 function** (minor confabulation). Faithfulness **2** on structure, **1** on content tie-back. |

### A. AI-side (turn 2 — participant-rated)

| WC | Cap | Top | Ladder | Next? | 1-topic | Filler | Drift | Struct 0–3 | Faith | KP |
| -- | --- | --- | ------ | ----- | ------- | ------ | ----- | ---------- | ----- | -- |
| **137** | Y | **Y** | **Y** | **Y** | Y | Y | HELD | 3 | 2 | _TBD_ |

### B. Expert rubric (turn 2)

| Conciseness | Struct. predict. | Redundancy ↓ | Re-orient | Stability |
| ----------- | ---------------- | ------------ | --------- | --------- |
| 5 | 5 | 1 | 4 | 4 |

### C. Participant form (T3 · Assist)

| U1 | U2 | U3 | U4 | U5 | U6 | U7 | U8 | U9 | U10 | U11 | U12 | U13 | U14 | U15 |
| -- | -- | -- | -- | -- | -- | -- | -- | -- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 1 | 1 | 7 | 7 | 7 | 7 | 7 | 7 | 7 | 7 | 7 | 7 | 7 |

| Resumption plan? | Comprehension | T3 compare |
| ---------------- | ------------- | ---------- |
| not marked | not marked | not marked |

---

# Block T4 — tool-heavy (S4) — optional

## T4 · Baseline (Assistive mode Off)

### Session context

```text
Here's a comparison of the founding years of the United Nations and NATO:

The United Nations was founded in 1945.
The North Atlantic Treaty Organization (NATO) was founded in 1949.
Comparing these years matters for reading timelines because it highlights the immediate post-World War II global effort towards international cooperation (UN) followed by the emergence of Cold War alliances and collective defense strategies (NATO).
Sources:

History of the United Nations
NATO - Wikipedia
```

| Notes | webSearch ×2. **WC = 73** (incl. Sources lines). Top summary **N** · Step ladder **N** · Next? **N**. 3 bullets + comparison sentence. Facts correct. Sources appended. |

### A. AI-side

| WC | Cap | Top | Ladder | Next? | 1-topic | Drift | Faith | Struct 0–3 |
| -- | --- | --- | ------ | ----- | ------- | ----- | ----- | ---------- |
| **73** | Y | **N** | **N** | **N** | Y | HELD | 2 | 1 |

---

## T4 · ADHD Assist (Assistive mode On)

### Session context

```text
The United Nations (UN) was founded in 1945.
The North Atlantic Treaty Organization (NATO) was founded in 1949.
Comparing these founding years helps illustrate the rapid formation of new global and regional security structures in the immediate aftermath of World War II.
Next?
```

| Notes | **WC = 43.** Top summary **N** · Step ladder **N** · Next? **partial** (bare `Next?` — no continuation question; DRIFT — §4). Exactly 3 bullets + comparison line. No tools invoked. |

### A. AI-side

| WC | Cap | Top | Ladder | Next? | 1-topic | Drift | Faith | Struct 0–3 |
| -- | --- | --- | ------ | ----- | ------- | ----- | ----- | ---------- |
| **43** | Y | **N** | **N** | partial | Y | DRIFT — bare Next? | 2 | 2 |

### C. Participant form (T4 · optional)

| Baseline | Assist |
| -------- | ------ |
| “Exactly what I need”; 3 bullets + comparison | More **filler words** than Baseline; bare **Next?**; **no visible sources** to user (admin-only tool trace); inconsistent on re-run |
| Informal preference: **Baseline slightly** for conciseness on this prompt | Wants **citations shown in UI** not devtools |

---

# Block T5 — paraphrase repeat (S5) — optional

## T5 · Baseline (Assist off) — turns 1–2 same chat

| Participant reaction | “Blob”; **not gonna read**; bland vs ChatGPT |
| Assist (on) turn 2 | **Visually appealing**; separated concepts; **some fluff** trimmable; likes summary structure |

_Formal 1–7 grid not completed on recording — qualitative only._

---

# End of session

## AI-side summary (facilitator)

| Block | Baseline highlight | Assist highlight | Assist structural pass (Top+Next+cap strict) |
| ----- | ------------------ | ---------------- | --------------------------------------------- |
| T1 | Prose analogy, **99 w**, no Top/Ladder/Next | **73 w**, Next? **Y**, Top **N**, Ladder **N** | **Partial** (Next+cap; no Top header) |
| T2 drift turn | **DRIFT** merged topics **510 w** | **HELD** redirect **75 w** | Turn 3 rated: **193 w**, Ladder+Next **Y**, Top **N** → **Partial** |
| T3 resume | T1 **494 w** (over cap); T2 **66 w** lost plan / CS101 | T1 **221 w** full policy shape; T2 **137 w** 25-min ladder | T2 rated: **Pass** (Top+Ladder+Next+cap) |
| T4 | Tools used; **73 w**; correct facts | **43 w**; bare Next? | **Partial** |

## Debrief

| Source | Status |
| ------ | ------ |
| **Form** (end section) | ⏳ not filled on returned doc |
| **Recording** (qualitative) | See [`adhd-pilot-session-transcript-notes.md`](./adhd-pilot-session-transcript-notes.md) — strong Assist preference; persist toggle/course; NotebookLM-style courses; citations in UI |

### UX / product themes (not on 1–7 form)

- Loves: **stepladder**, **Next?**, **bold**, spacing, drift **redirect**, minute **timings**, word-by-word streaming
- Dislikes Baseline: **walls of text**, merged topics, no permission before topic switch
- **Session preferences must persist** — **Assistive mode** and **selected course** should carry over after page refresh or starting a new chat; only reset on **logout** (not on every reload)
- **Web search toggle** debated — worried users leave on always; prefers smart “not in module → ask to web search?”

### Session preferences persistence (P0 — product requirement)

| Setting | Current behavior (P01) | Required behavior |
| ------- | ---------------------- | ----------------- |
| **Assistive mode (ADHD Assist)** | Off by default after refresh; user must turn on again | **Remember last choice** for logged-in user until logout |
| **Course selection** | Lost on refresh; user must pick CS101 again | **Remember last course** for logged-in user until logout |
| **New chat** | Does not inherit toggle/course reliably | New chat inherits **same** Assist + course as previous session |
| **Logout** | — | Clear stored preferences (expected reset) |

_Rationale: P01 wanted Assist on for real studying; re-enabling mode and re-selecting course on every refresh adds friction and broke S3 resumption. Pilot sessions still use facilitator-controlled toggle per block — this requirement is for **production `/chat` UX**, not the tier-B test protocol._

### UI research directions (follow-up before bigger study)

| Reference | What to study | Why (P01 session) |
| --------- | ------------- | ----------------- |
| **[NotebookLM](https://notebooklm.google/)** | **Per-course workspace**: user picks a course/source once; chat stays scoped to that material; replies feel **course-specific** rather than generic tutor mode | Lost CS101 on reload; S3 resumption invented context; participant wanted “pick course and stay in it” |
| **ChatGPT chat layout** | **Simpler prompt ↔ response alignment**: user message and tutor reply visually paired (full-width blocks, less bubble/thread noise); reduce “who said what” cognitive load | Baseline blob hard to re-orient; bubble + highlight UI lost place; participant compared unfavorably to ChatGPT readability |

**Action items for design spike:**

0. **Persist session preferences** — store Assist toggle + course in user session (server) and/or durable client storage; restore on `/chat` load and new chat; clear on logout only.
1. **NotebookLM pattern** — sidebar or header course picker that **persists** across reload; scope RAG + tutor tone to selected course/module; show which course is active before every reply.
2. **ChatGPT pattern** — prototype a **flat, aligned transcript** (prompt above response, consistent width, minimal chrome) vs current bubble layout; test with ADHD learners on S1/S3 re-read tasks.

See also product backlog table in [`adhd-pilot-session-transcript-notes.md`](./adhd-pilot-session-transcript-notes.md).

## Paired deltas (Assist − Baseline, form U-scores)

| Block | Δ U1 Mental | Δ U2 Rushed | Δ U3 Frustration | Δ U4 Effort | Δ U7 Layout | Δ U15 Want again |
| ----- | ----------- | ----------- | ---------------- | ----------- | ----------- | ---------------- |
| T1 | +3 | −4 | −3 | +4 | **+5** | **+6** |
| T2 | −3 | −4 | −3 | −4 | **+3** | **+3** |
| T3 | **−6** | **−6** | **−6** | **−6** | **+6** | **+6** |

### Composite (T1–T3 means)

| Metric | Baseline avg | Assist avg |
| ------ | ------------ | ---------- |
| Load items U1–U4 | 5.1 | **1.9** |
| Structure U7 | 2.3 | **7.0** |
| Preference U15 | 2.0 | **7.0** |

_T1 Assist load items (U1=6, U4=7) are higher than T2/T3 Assist; U15 and structure items still strongly favor Assist on T1._

---

## Post-session checklist

- [x] All block context sections filled (assistant text)
- [x] T2 turn-2 drift rows scored (Baseline + Assist)
- [x] Participant form → all U1–U15 from [`ADHD Assist pilot test— form1.md`](./ADHD%20Assist%20pilot%20test%E2%80%94%20form1.md)
- [x] Paired deltas computed (T1–T3)
- [ ] Go/no-go updated in [`adhd-user-reaction-recording.md`](./adhd-user-reaction-recording.md) § 7 (facilitator + PI)
- [x] No participant chat text committed to git (transcripts in this sheet only)

---

## Metric anchors

Full ID list and rubric anchors: [`adhd-user-reaction-recording.md`](./adhd-user-reaction-recording.md) § 2.
