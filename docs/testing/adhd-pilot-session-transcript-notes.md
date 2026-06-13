# Pilot session — transcript synthesis (P01)

Qualitative extract from recorded facilitator + participant session (2026-05-31). Quantitative 1–7 scores live in [`adhd-pilot-facilitator-sheet.md`](./adhd-pilot-facilitator-sheet.md) section C.

**Participant:** Speaker 2 (P01) · **Facilitator:** Ayyhab (Speaker 1)

---

## Executive summary

Single ADHD learner pilot strongly preferred **Assistive mode On** across S1–S3. Baseline failures were consistently described as **“blob” / wall-of-text** overload, especially under time pressure (exam scenario). Assist wins were attributed to **spacing, bold key terms, stepladder, Next?**, and **asking before merging topics** (S2 drift). Top product gaps: **state lost on page reload** (toggle + course), **course selection UX**, **visible citations** for web answers, and **chat layout simplification** (see UI research below).

---

## By block — participant voice

### S1 (gradient descent)

| Mode | Quote / theme |
| ---- | ------------- |
| **Off** | “Such a **big blob**”; rereads same paragraph; highlight-on-tap UI loses place; wants **bullets for main concepts** first |
| **On** | “**Bold**… spaced out”; “read first sentence, look away, look back”; **Next?** = “felt in control”; “**100%**” want this again |

### S2 (dishes + drift)

| Mode | Quote / theme |
| ---- | ------------- |
| **Off** | Turn 1 steps OK with labels; turn 2 merge = “**so much in my face**”, “**humongous**”, “**didn't bother reading**”; facilitator clarified **one-topic** = should ask before switching |
| **On** | “**Wow… I like this a lot more**”; redirect = “**Are you sure?**” vs “thrown in my face”; turn 3 = “**take my time**”, clarify or move on |

### S3 (exam plan + resume)

| Mode | Quote / theme |
| ---- | ------------- |
| **Off** | Turn 1: “**I'm not reading this**”; “Good luck” only payoff; exam stress + long read = “**taxing**”; CS101 retry still too long |
| **On** | “**So much better**”; minute breakdown (5+2+15+3); “**sleep-deprived / ADHD / in a rush**”; doubts Baseline time estimates |

### S4 (UN vs NATO)

| Mode | Quote / theme |
| ---- | ------------- |
| **Off** | “Exactly what I need”; sources in output |
| **On** | More words / filler; **Next?** empty; wants **sources visible to user**, not devtools |

### S5 (equality paraphrase)

| Mode | Quote / theme |
| ---- | ------------- |
| **Off** | “Blob… not gonna read” |
| **On** | Separated sections + reflection; “**some fluff**” could trim |

### Free-form (Assist on, web + course)

Liked structured muscle-origin answer with **sources shown** when web search ran; word-by-word streaming “easier to follow”.

---

## Product backlog from session (priority)

| Priority | Item | Participant rationale |
| -------- | ---- | --------------------- |
| P0 | **Persist Assistive mode + course until logout** | User should **not** manually re-enable ADHD Assist or re-select a course on every page refresh or new chat; restore from the **previous logged-in session**. Only reset when the user **logs out** |
| P0 | **Course context UX** — study **[NotebookLM](https://notebooklm.google/)** | Pick a **course/source once** and stay in that workspace; tutor replies should feel **scoped to that course** (module RAG, terminology, resumption) — not generic chat. Avoid re-selecting CS101 every reload (S3 failure) |
| P1 | **Simpler chat layout** — study **ChatGPT UI** | Align **prompt and response** in a clean vertical flow (full-width blocks, less bubble/thread clutter); easier to scan and re-find your place after looking away (S1 Baseline blob + highlight UI friction) |
| P1 | **User-visible citations** when tools/web used | Trust / anti-fabrication |
| P2 | Smart prompt: “**Not in module — web search?**” | Reduces toggle overload vs always-on web |
| P2 | Trim **Assist fluff** on factual short answers (S4, S5) | Assist added words vs Baseline |
| P3 | Fix **bare Next?** (S4 Assist) | Policy compliance |

---

## Session preferences persistence (P0)

**Requirement from P01:** Do not force users to **re-toggle Assistive mode** or **re-choose a course** each time they refresh the page or open a new chat.

| Event | Assistive mode | Selected course |
| ----- | -------------- | ----------------- |
| Page refresh | Restore last value | Restore last value |
| New chat (same login) | Restore last value | Restore last value |
| Logout | Reset (or default) | Reset (or none) |

Implementation should bind preferences to the **authenticated user**, not a single chat thread. Quote theme: “Doesn't remember your settings anymore.”

---

## UI research directions (for design / Phase 2.5+)

### NotebookLM — per-course workspace

- **Pattern:** User selects a notebook/course up front; all Q&A is grounded in that source set; switching course is an explicit action, not accidental loss on reload.
- **Apply to EduAI:** Course picker in sidebar or header; **persist selection** in session + local storage; badge showing active course; tutor preface or system context tied to module materials; resumption (S3) should recall **that course’s plan**, not invent CS101.
- **Success check:** After reload **and** after new chat, same course + Assist toggle as before; S3-style “pick up the plan” references prior turn-1 breakdown without facilitator retry. Preferences unchanged until logout.

### ChatGPT — prompt/response alignment

- **Pattern:** User message and assistant reply stacked with **consistent width and minimal chrome**; less “chat app” bubble asymmetry; content is the focus.
- **Apply to EduAI:** Prototype **flat transcript layout** (user block → tutor block, same column width); reduce visual noise from avatars/labels when user is in focused study mode; pair with Assist structure (Top summary, Step ladder) so scan paths stay predictable.
- **Success check:** P01-style task — read first bullet, look away, look back — without losing place; compare bubble vs flat in a follow-up A/B with ≥2 learners.

---

## Protocol / methods notes (for PI)

1. **S3 deviated from no-course script** — facilitator added CS101 after failed resume; document in appendix.
2. **Facilitator coaching** on S2 U8 (one-topic) and S3 rating context — acceptable for pilot; avoid in formal Track B.
3. **Demand characteristics** — facilitator said “honest opinion” before Assist S2; participant already strongly pro-Assist from S1.
4. **n=1** — strong directional signal only; need ≥2 more tier-B sessions for G3.
5. **AI-side + user-side align** on S2 drift (Baseline DRIFT / Assist HELD) — good construct validity for this participant.

---

## Suggested quotes for IURA / demo (anonymized)

> “With ADHD, what I really like is having bullet points… main concepts first.”

> “When it's chopped up, then it's easier… okay, I need to read the first bullet, then the second.”

> “It made sure — are you sure? — instead of just throwing it right to you.”

> “If I have an exam in three hours… I'm not reading [a whole plan]… that's gonna cut down on my study time significantly.”

---

## Related files

- Scores + AI metrics: [`adhd-pilot-facilitator-sheet.md`](./adhd-pilot-facilitator-sheet.md)
- Blank form: [`adhd-pilot-participant-form.md`](./adhd-pilot-participant-form.md)
- Go/no-go gates: [`adhd-user-reaction-recording.md`](./adhd-user-reaction-recording.md) § 7
