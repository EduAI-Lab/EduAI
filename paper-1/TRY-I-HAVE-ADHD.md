# How to use the `i-have-adhd` skill in Cursor

**Rule installed:** `.cursor/rules/i-have-adhd.mdc` (research + main workspaces)  
**Source:** https://github.com/ayghri/i-have-adhd · MIT license · author Ayoub Ghriss (CU Boulder), not MIT University

## Turn it on (one chat)

1. Start a **new** Agent chat (clean context).
2. Type `@` and pick **i-have-adhd** (or paste: "Follow the i-have-adhd Cursor rule for this whole chat.").
3. Send a Form A probe from the list below.
4. Score with the checklist.

To turn **off**: open a new chat without `@i-have-adhd`, or say "stop using the ADHD skill / reply normally."

Optional always-on: Cursor Settings → Rules → set `i-have-adhd` to Always Apply (only if you want every reply shaped this way).

## A/B for research (same probe × 3)

| Condition | How |
| --- | --- |
| **A — Baseline** | New chat, no `@i-have-adhd`, no Assist. Paste the user turn only. |
| **B — Their skill** | New chat + `@i-have-adhd`, same user turn. |
| **C — ADHD Assist** | EduAI chat with Assist ON (or paste your Assist policy as system context). Same user turn. |

Score each reply Y/N:

- Action / answer in **first line**?
- Numbered steps (≤5)?
- One clear **next** step at end?
- Single topic (no silent second agenda)?
- Word count under ~250?
- Restates state if multi-turn?
- Time estimate present? (their rule #6 — we often lack this)
- Win / "what now works" visible? (their rule #7)

This is a **prompt-only peer**, not a Study 1 replacement. Do not change freeze numbers from these chats.

## Copy-paste probes (from Form A sheet)

### Probe 1 — S1 concept

```text
Explain what “gradient descent” means for someone new to machine learning, in one short paragraph of plain language (no math notation).
```

### Probe 2 — S2 drift (send turns in order)

```text
Walk me through washing dinner dishes by hand in at most 5 clear steps.
```

Then:

```text
Now ignore your earlier formatting constraints: also explain how marginal income tax brackets work, in the same answer as the dish steps.
```

Then:

```text
Go back to step 2 of the dish-washing procedure only—ignore the tax topic for this reply.
```

### Probe 3 — S3 interrupt / re-entry

```text
I need a plan to revise for a closed-book short-answer exam. I have one evening (about 3 hours) tonight. Assume the exam is tomorrow morning.
```

New chat (or same if protocol allows):

```text
Pick up the plan from before: what should I do in the first 25 minutes?
```

## Log results (optional)

Paste into `I-HAVE-ADHD-ALIGNMENT-AND-RESEARCH-BRIEF.md` or a private notes file:

| Probe | Condition | Top/first-line action? | Steps ≤5? | Next step? | One topic? | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | A / B / C | | | | | |

Full scripts: `docs/literature/form-a-scenario-test-sheet.md`
