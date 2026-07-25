# Manual Test Plan — #1120 + #1147

Branch `feat/settings-dedup-1147` (9 commits off `development`). 2026-07-24.

Ordered by **risk**, not by commit order. If you only have 30 minutes, do §1 and §2 —
those are the changes automated tests do not cover. §7–§9 are quick visual confirmations.

## Setup

```bash
git checkout feat/settings-dedup-1147
npm install
npm run dev            # predev kills ports + starts the three dev DBs via Docker
npm run dbseed         # if this is a fresh DB
```

| App | URL |
|---|---|
| Core | http://localhost:3000 |
| AI Tutor | http://localhost:3001 |
| Question Maker | http://localhost:5173 |

Seed logins — password `EduAI2026!` for all:

| Role | Email |
|---|---|
| Admin | `admin@eduai.local` |
| Instructor | `instructor.cs@eduai.local` |
| Student | `student1@eduai.local` |
| Unit Admin | `unitadmin.cosc@eduai.local` |

> **Core note:** if Core fails to start with `Property 'aiJob' does not exist`, run
> `npm run db:generate -w edu-ai`. That failure is pre-existing on `development`, not from
> this branch.

---

# 1. QM toasts — HIGHEST RISK 🔴

**Why this is first:** the `use-toast` shim was deleted and **159 call sites** were rewritten
by codemod to call `sonner` directly. QM's unit suite does not assert on toasts, so this rests
entirely on the typechecker. If anything on this branch is broken, it is most likely here.

**What a failure looks like:** a toast that shows the word `undefined`, shows `[object Object]`,
shows a blank body, never appears at all, or appears but its action button does nothing.

Log into QM as **admin**. For each action below, confirm a toast appears with **both a title
line and a readable description** (where one is expected), and no `undefined`/`[object Object]`.

### 1a. Plain toasts
- [ ] Settings → Providers → paste any text as an API key → **Save** → "…API key saved"
- [ ] Settings → Providers → **Remove** a saved key → "…API key removed"
- [ ] Settings → Providers → change **Default model** → "Default model updated"
- [ ] Course → rename/save a question → success toast

### 1b. Error toasts (should be red/destructive)
- [ ] Settings → Canvas tab → enter a bogus URL (`https://not-a-canvas.invalid`) → **Connect**
      → red "Failed to connect Canvas" **with a reason in the description, not `undefined`**
- [ ] Stop the QM backend, then attempt any save → red error toast with a real message

### 1c. Toasts with an ACTION BUTTON — most fragile 🔴
The shim used to accept a `<ToastAction>` React element and reflect it into sonner's action
option. That was converted by hand at 3 sites. **The button must appear and must work.**

- [ ] **Course detail → upload/extract questions** → while it runs you get an "Extraction in
      progress" toast that must persist (not auto-dismiss)
- [ ] When extraction finishes → "Your extraction is ready" toast with a **"Review questions"**
      button → click it → the upload dialog opens
- [ ] **Question composer → Generate with AI**, with a deliberately invalid API key →
      error toast with a **"View Details"** button → click it → error-details dialog opens
- [ ] Same in the **Add Question dialog** AI generation path → "View Details" opens the modal

### 1d. Toast dismissal — the `.dismiss()` handles
The shim returned `{ id, dismiss }`; sonner returns a bare id. Three sites were rewritten.

- [ ] During AI generation, the "generation in progress" toast appears and then
      **disappears on its own** when generation finishes or fails — it must not linger forever
- [ ] Extraction: the "in progress" toast disappears once the result toast appears
      (you should never see both stacked)

---

# 2. Settings pages — all three apps rewritten 🔴

Every settings page now renders through the shared `SettingsPageScaffold`. Tab state,
spacing, and page padding all moved.

### 2a. QM Settings — includes a bug fix and a new tab
http://localhost:5173/settings

- [ ] Subheading no longer mentions "your account" (QM has no account tab) — it should read
      *"Manage your AI provider keys, Canvas connection, and accessibility preferences."*
- [ ] There are now **three** tabs: Providers, **Canvas**, Accessibility
- [ ] **Canvas is its own tab** with a link icon — it used to be a card buried inside Providers
- [ ] Page opens on **Providers**
- [ ] Switching tabs works; content changes
- [ ] Vertical gaps between cards look even — no card sitting flush against the one above
      (the old `mt-4` spacing hacks were removed in favour of scaffold-owned spacing)
- [ ] A **Sign out** card appears at the bottom, below the tab strip
- [ ] Sign out actually logs you out

### 2b. Core Settings
http://localhost:3000/settings — check as **admin** and again as **student**

- [ ] Tabs render: Account, Accessibility, **API Keys (admin only)**, Providers,
      **Canvas (instructor/admin only)**
- [ ] As **student**: no API Keys tab, no Canvas tab
- [ ] As **admin**: API Keys tab present and its two cards both render
- [ ] Canvas tab, when the integration is disabled by policy, still shows the
      **disabled tooltip** on hover over the tab
- [ ] Tab bodies still **fade/slide in** (Core's ScrollReveal motion moved into the scaffold —
      it should look the same as before, not static)
- [ ] Sign-out card at the bottom, title now **"Sign out"** (was "Account")
- [ ] Page padding looks unchanged — content not jammed against the left edge or double-indented

### 2c. Core password-expired banner
- [ ] If you can trigger an expired password (or temporarily force `passwordExpired` true),
      the amber "Your password has expired" banner appears **between the heading and the tabs**

### 2d. AI Tutor Settings
http://localhost:3001/settings

- [ ] Tabs: Account, Accessibility, Providers
- [ ] Account tab shows your avatar, name, email, role badge
- [ ] Sign-out card at the bottom; logging out works
- [ ] **Assistive Mode toggle still works** (Accessibility tab) — flip it on and confirm the
      reading treatment applies; this is BREB-approved behaviour that must not regress

---

# 3. Bug reports admin — 3 implementations replaced by 1 🔴

Log in as **admin** in each app.

| App | Path |
|---|---|
| Core | http://localhost:3000/admin/bug-reports |
| QM | http://localhost:5173/admin/bug-reports |
| AI Tutor | http://localhost:3001/admin → Bug reports tab |

Submit a bug report first (bug-report button in each app's UI) so there is data.

### 3a. Behaviour that must be identical in all three
- [ ] Table renders with rows
- [ ] **Sort** by clicking each column header; arrow flips ▲/▼ on second click
- [ ] **Type column is now sortable in AI Tutor** (it previously was not, while Core and QM were)
- [ ] Filters: Status / Type / Reporter / free-text search all narrow the list
- [ ] "Showing N of M reports" line updates as you filter
- [ ] "Clear filters" resets everything
- [ ] Filtering to nothing shows *"No reports match your filters…"*
- [ ] **Change a report's status** → the badge updates and persists after a page reload
- [ ] Anonymous reports do **not** reveal reporter name/email

### 3b. Evidence viewers — NEW in Core and QM
Core previously discarded these fields entirely; an admin could not open a screenshot that
was already in the response.

- [ ] **Core**: open a report → console log viewer, network log viewer, and **screenshot**
      all open (these did not exist in Core before)
- [ ] Console viewer's level filter (all/log/warn/error) works
- [ ] Network viewer's request dropdown + meta/request/response/headers tabs work
- [ ] **Copy** button copies a text dossier; anonymous reports omit identifying fields

### 3c. Core-only: source column and truncation notice
- [ ] Core's table has a **Source** column (QM and AI Tutor do not — they pin source by fetch)
- [ ] Source column sorts
- [ ] If your DB has **more than 200** bug reports, a notice appears reading
      *"Showing the 200 most recent of N reports."* — previously Core silently showed only 50
      with no indication. (Skip if you have fewer than 200; it is not worth seeding.)

---

# 4. #1120 — review-status confirmation ⚠️

This is the feature the issue asked for. Log into QM as an **instructor or admin**.

### 4a. Assessment section kebab (the real kebab menu)
Course → Assessments → open an assessment → question row → **⋮** menu

- [ ] Click **"Mark reviewed"** → a confirmation dialog opens and **no request fires yet**
      (watch the Network tab — there should be no `PATCH`/`PUT` until you confirm)
- [ ] Dialog copy reads *"Reviewed questions can be exported and used in assessments."*
- [ ] Confirm button is labelled **"Mark as reviewed"** — not "OK"
- [ ] **Cancel** → status unchanged, no request sent
- [ ] Confirm → status changes to reviewed, toast appears
- [ ] Now open the kebab on a **reviewed** question → **"Mark as draft"**
- [ ] Dialog copy differs: *"It will be excluded from export until it is reviewed again."*
- [ ] Confirm button reads **"Move to draft"** and is styled **destructive/red**
- [ ] Confirm → question returns to draft; the "Mark as reviewed before exporting" warning
      reappears on the card

> **Regression watch:** the dialog is deliberately rendered outside the Radix dropdown, because
> menu content unmounts on close. If you see the dialog flash and instantly vanish, that is the
> bug this guards against.

### 4b. Question dialog footer button
Open a question → **view** mode → footer

- [ ] The **"Mark as Reviewed" / "Mark as Draft"** footer button now opens the same confirmation
- [ ] Cancel → nothing happens
- [ ] Confirm → status changes and the badge updates
- [ ] Copy matches the direction, same as 4a

### 4c. Error path
- [ ] Stop the QM backend → attempt a status change → confirm → the error toast shows a
      **real message**, not `undefined` (both surfaces previously read the failure differently)

---

# 5. QM delete dialogs 🟡

Delete confirmations moved to the shared `ConfirmDialog`, which was widened to keep the
in-flight state QM's local modal had.

- [ ] **Assessment builder** → delete the assessment → confirm dialog appears
- [ ] While the delete is in flight, the confirm button reads **"Delete…"** and **both buttons
      are disabled** — the dialog must stay open, not vanish instantly
- [ ] You cannot double-click Delete to fire two requests
- [ ] Cancel → nothing deleted
- [ ] **Course detail** → delete a question/variant → same behaviour
- [ ] **Course detail** → delete an assessment → same behaviour
- [ ] **Question upload dialog** → close with unsaved questions → the **three-button**
      "Unsaved Questions" dialog still appears with Keep Editing / Discard / Save Questions
      (this one was deliberately *not* migrated — it must be unchanged)

---

# 6. Core BYOK provider keys 🔴 (security-relevant)

http://localhost:3000/settings → **Providers** tab, as admin.

- [ ] Type into the OpenAI key field → **characters are masked as dots**. Previously this input
      had no `type` at all and rendered keys in plaintext.
- [ ] Same for the Google AI field
- [ ] The card description now says keys are **saved to your EduAI account and used
      server-side** — it used to claim "Local, browser-stored", which was false
- [ ] Save a key → badge flips to **Configured**
- [ ] Expiry date picker appears; setting a date persists across reload
- [ ] **Clear** removes the expiry
- [ ] **Remove** clears the key
- [ ] **Ollama** block is unchanged — Enable/Disable button, no key input
- [ ] The env-var help panel below still renders

> Both provider blocks are now generated from one `.map()`, so a bug in one will show in both.

---

# 7. Spinners 🟡

35 inline loaders were replaced with a shared `Spinner`. All should look **identical** and
spin. Nothing should become a full-page loader.

- [ ] QM: save an API key → button spinner
- [ ] QM: assessment variant page → generating state
- [ ] QM: question upload → processing state
- [ ] Core: canvas integration → connect/fetch spinners
- [ ] Core: course materials upload
- [ ] Core: change password → submitting
- [ ] AI Tutor: student chat → thinking indicator
- [ ] AI Tutor: instructor lesson → saving states

> **Failure mode to watch for:** a spinner that renders as a full-screen centred "Loading…"
> block that takes over the page. That would mean an inline spinner was wrongly swapped for
> `PageLoader`.

---

# 8. PermissionGate / sign-out 🟢

- [ ] QM as **student**: authoring actions (create question, export, edit assessment) stay hidden
- [ ] QM as **instructor**: those actions are visible
- [ ] AI Tutor instructor course/module/lesson pages: edit controls visible to instructor,
      hidden from student
- [ ] Sign out works from Core, QM, and AI Tutor settings pages

---

# 9. Theming 🟢

- [ ] Flip dark mode in each app's Accessibility settings
- [ ] **Core dashboard donut charts change colour with the theme** — they previously kept
      light-mode hues in dark mode while AI Tutor's adapted
- [ ] Settings pages, bug-report tables, and confirm dialogs all readable in both themes
- [ ] Difficulty chips / status badges unchanged

---

## Known issues — NOT regressions from this branch

1. **Core `aiJob` Prisma type errors** — pre-existing on `development`; fix with
   `npm run db:generate -w edu-ai`.
2. **QM bug-report network logs render as `{}`** in the structured network viewer. QM's capture
   hook only records `{method, url, status, durationMs, timestamp}` — it never captured request
   or response bodies — while the viewer (from AI Tutor) expects them. Pre-existing data
   mismatch, deliberately left alone because `origin/fix/979-cap-redact-bug-report-fields` is
   in flight on those capture hooks. AI-Tutor-sourced reports show full detail.
3. **`packages/ui` streamdown-math test type errors** — pre-existing, 2 errors on a clean tree.
4. **Chunk-size warning on QM build** — pre-existing.

## If you find a bug

Note which section, the app, and the exact on-screen text. The highest-value reports are from
**§1 (toasts)** — that is the change with the least automated coverage.
