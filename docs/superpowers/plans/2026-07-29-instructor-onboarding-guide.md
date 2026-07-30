# Instructor Onboarding Guide (#816) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `docs/INSTRUCTOR_ONBOARDING.md` — a plain-language, from-zero pilot instructor guide covering Core (incl. Canvas), AI Tutor, and Question Maker, with screenshot placeholders and a root README link.

**Architecture:** One markdown guide under `docs/`. UI facts come from current routes/components (not inventing screens). Screenshot placeholders use stable IDs; images are added later by a human under `docs/images/instructor-onboarding/`.

**Tech Stack:** Markdown only. Sources of truth: Core routes (`/auth/accept-invitation`, `/settings` Canvas tab, `/courses`, course detail), AI Tutor instructor routes, QM course + generate flows, `docs/DEPLOYMENT.md` / `docs/ARCHITECTURE.md` for hostnames.

**Commit policy:** Do **not** commit this plan or `docs/superpowers/specs/*` unless the user asks. Commit the guide + README link only when the user asks.

**Spec:** `docs/superpowers/specs/2026-07-29-instructor-onboarding-guide-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `docs/INSTRUCTOR_ONBOARDING.md` | Full instructor guide (create) |
| `docs/images/instructor-onboarding/README.md` | Drop zone note for future PNGs (create) |
| `README.md` | Add Docs table row linking the guide (modify) |

---

### Task 1: Confirm production URLs + open limitations

**Files:**
- Read: `docs/DEPLOYMENT.md`, `docs/ARCHITECTURE.md`, `docs/rag-ai/HOW_TO_USE_DEV_SERVER.md`
- (No code changes yet)

- [ ] **Step 1: Resolve hostname table for the guide header**

From docs, use this default table unless the team has a different pilot URL (if unsure, prefer production pattern and note “confirm with your pilot coordinator”):

| App | Production (typical) | Shared dev (s378) |
|-----|----------------------|-------------------|
| Core | `https://my.eduai.ok.ubc.ca` | `https://dev.eduai.ok.ubc.ca` |
| AI Tutor | `https://ai-tutor.eduai.ok.ubc.ca` | `https://dev.aitutor.eduai.ok.ubc.ca` |
| Question Maker | `https://questionmaker.eduai.ok.ubc.ca` (verify against DEPLOYMENT / env if named differently) | `https://dev.questionmaker.eduai.ok.ubc.ca` |

Record the chosen **pilot primary** set (production vs dev) in a one-line comment at the top of your notes for Task 2. Spec: audience is production/pilot deployment — default to **production** column; if pilot is actually on `dev.*`, use that column and say so in the Welcome section.

- [ ] **Step 2: Check open issues for Known limitations**

```bash
gh issue list --state open --limit 30 --search "enrollment OR canvas OR instructor OR publish OR pilot"
```

Copy any still-relevant instructor-facing bugs into a short list for section 8. **Do not** list closed #812 as current. If nothing relevant is open, write honest soft limitations (e.g. policy flags may hide Canvas/create-course; enrollments sync lag between apps).

---

### Task 2: Create `docs/INSTRUCTOR_ONBOARDING.md`

**Files:**
- Create: `docs/INSTRUCTOR_ONBOARDING.md`

- [ ] **Step 1: Write the full guide**

Create the file with the content below. Replace `{{CORE_URL}}`, `{{AI_TUTOR_URL}}`, `{{QM_URL}}` with the URLs from Task 1. Keep every screenshot placeholder block. Adjust UI label wording only if you verify a different label in the app (e.g. tab names on course detail).

```markdown
# EduAI instructor onboarding

**Who this is for:** Instructors joining the EduAI pilot.  
**What you will do:** Create your account, connect Canvas, set up a course in Core, then try AI Tutor and Question Maker.

| App | URL |
|-----|-----|
| EduAI (Core) | {{CORE_URL}} |
| AI Tutor | {{AI_TUTOR_URL}} |
| Question Maker | {{QM_URL}} |

You sign in once on Core. The other apps reuse that session (same browser). Use the app switcher in the header to move between apps.

---

## 1. Welcome

EduAI has three parts:

1. **Core** — courses, materials, enrollments, chat with course materials, Canvas connection  
2. **AI Tutor** — modules, lessons, activities, and tutoring chat for students  
3. **Question Maker** — question banks and AI-assisted question drafting  

This guide walks a **happy path** from your invitation email through a first useful setup in each app. Short “If you’re stuck” tips are at the end.

---

## 2. Get an account

### Accept your invitation

Your admin (or unit admin) sends an invitation email. Open the link and set your password when prompted.

> **Screenshot needed:** `invite-email-or-accept`  
> Capture: Invitation email **or** the accept-invitation page (`/auth/accept-invitation`).  
> Show: Clear call-to-action to accept / set password.

### Sign in

Go to {{CORE_URL}} and sign in (campus login / EduAI sign-in as shown on the page).

> **Screenshot needed:** `core-sign-in`  
> Capture: Core sign-in page.  
> Show: Sign-in options visible (CWL/OAuth or email as deployed).

### Land on your dashboard

After sign-in you should see the Core home / courses area.

> **Screenshot needed:** `core-dashboard-after-login`  
> Capture: Core after successful login.  
> Show: Sidebar (or nav) and main content (courses list or empty state).

**If you’re stuck:** The invite link expired — ask your admin to resend. Wrong role (e.g. Student) — ask them to invite you as **Instructor**.

---

## 3. Connect Canvas and sync courses

Canvas is how many pilot courses enter EduAI.

### Open Canvas settings

In Core, open **Settings**. Find the **Canvas** (or integration) section.

> **Screenshot needed:** `canvas-connect-form`  
> Capture: Settings → Canvas connection form (before or after connect).  
> Show: Canvas URL field and API token / connect controls.

### Connect

1. Enter your Canvas base URL (for example your institution Canvas host).  
2. Paste a Canvas personal access token with permission to read your courses.  
3. Save / Connect. Wait for a success state (not an error).

### Sync courses into EduAI

Return to **Courses**. Use **Sync from Canvas** (or equivalent) and choose the course(s) to bring into EduAI.

> **Screenshot needed:** `canvas-sync-courses`  
> Capture: Sync-from-Canvas dialog and/or Courses list after a successful sync.  
> Show: At least one synced course visible.

Open the course you will teach.

**If you’re stuck:** No courses after sync — confirm the Canvas token can see teacher courses, and that the Canvas policy for instructors is enabled on this deployment. Connection errors — check URL (no trailing path junk) and token validity.

---

## 4. Core course basics

On the course page you will use tabs (or sections) for materials, enrollments, and publish.

> **Screenshot needed:** `core-course-detail-tabs`  
> Capture: Course detail with tabs/sections visible.  
> Show: Course title and navigation among Materials / Enrollments / etc.

### Materials

Upload or sync course materials so chat can use them later.

> **Screenshot needed:** `core-materials`  
> Capture: Materials tab with at least one file or empty upload UI.  
> Show: Upload / list controls.

### Enrollments

Review who is enrolled. Add students or TAs as your pilot process requires.

> **Screenshot needed:** `core-enrollments`  
> Capture: Enrollments tab/list.  
> Show: At least one enrollment row or the empty + add UI.

### Publish the course

When the course should be visible to students, use **Publish** (unpublished courses stay instructor-only for students).

> **Screenshot needed:** `core-publish`  
> Capture: Publish / unpublish control on the course.  
> Show: Current published state clearly.

**If you’re stuck:** Cannot publish — a platform policy may disable instructor publish; ask your admin. Students cannot see the course — confirm publish **and** that they have an active enrollment.

---

## 5. Switch to AI Tutor

### Open AI Tutor

From Core, use the **app switcher** (brand / apps control in the header) and choose **AI Tutor**.

> **Screenshot needed:** `app-switcher`  
> Capture: App switcher open, showing Core / AI Tutor / Question Maker.  
> Show: AI Tutor entry highlighted or visible.

You should land on an instructor-friendly home (dashboard or course list).

> **Screenshot needed:** `aitutor-instructor-home`  
> Capture: AI Tutor instructor home after login.  
> Show: Courses or instructor navigation.

### Publish a module or lesson

Open your course → a module → (optionally) a lesson. Use the **Publish** control so students can see that content when the parent course/module rules allow.

> **Screenshot needed:** `aitutor-publish-module-lesson`  
> Capture: Module or lesson page with publish toggle.  
> Show: Unpublished → published (or the control clearly labeled).

### Enrollments panel

Open the course enrollments panel. Note what you can manage here versus what is owned in Core (roster often mirrors Core; some actions may be read-only depending on role and sync).

> **Screenshot needed:** `aitutor-enrollments-panel`  
> Capture: AI Tutor course enrollments panel.  
> Show: List of members and available actions (or read-only state).

**If you’re stuck:** AI Tutor asks you to sign in again — return to Core, sign in, then use the app switcher (shared session cookie). Course missing — import/link from Core or wait for sync; ask support if it never appears.

---

## 6. Question Maker (one happy path)

### Open Question Maker

From the app switcher, open **Question Maker**.

### Select or link your course

Pick the EduAI course you just set up (link to Core if prompted).

> **Screenshot needed:** `qm-course-picker`  
> Capture: Course list or course picker / link-to-Core UI.  
> Show: Your course selected or available.

### Generate questions once

Use AI-assisted generation for a small set of questions (one topic is enough for this walkthrough).

> **Screenshot needed:** `qm-generate-questions`  
> Capture: Generate-questions UI mid-flow or ready to submit.  
> Show: Model/provider defaults as shown in the UI (do not paste secrets).

### Confirm they appear in the bank

Open the question bank / course questions list and find the new items.

> **Screenshot needed:** `qm-question-in-bank`  
> Capture: Question bank with at least one generated question.  
> Show: Title/stem visible.

**If you’re stuck:** Generation fails — campus model may be busy; retry or ask your coordinator. Course not listed — confirm Core enrollment/instructor access and that QM can reach Core.

---

## 7. If you’re stuck (quick reference)

| Symptom | What to try |
|---------|-------------|
| Invite link dead | Ask admin to resend invitation |
| Signed in but “wrong” home | Confirm your role is Instructor (not Student-only) |
| No courses after Canvas sync | Re-check Canvas token permissions; retry sync |
| Cannot publish | Ask admin about instructor publish policy |
| Extension sends you to login | Sign in on Core first, same browser, then app switcher |
| Students cannot see content | Course published + content published + active enrollment |

---

## 8. Known limitations

<!-- Fill from Task 1 open-issue scan. Example soft limitations if none: -->

- Some instructor actions (create course, Canvas, publish) can be turned off by admin **policy flags**. If a button is missing, it may be intentional for this pilot.  
- Roster changes can take a short time to appear in AI Tutor after you change enrollments in Core.  
- Do not treat closed historical bugs as current unless your coordinator says otherwise.

---

## 9. Walkthrough checklist (team dry-run)

Have a teammate act as a **new instructor** and check each box (or file a follow-up issue):

- [ ] Accepted invite and signed in on Core  
- [ ] Connected Canvas and synced at least one course  
- [ ] Opened materials, enrollments, and publish on Core  
- [ ] Opened AI Tutor via app switcher; published a module or lesson  
- [ ] Opened enrollments panel in AI Tutor  
- [ ] In Question Maker: selected course, generated questions, saw them in the bank  
- [ ] Screenshot placeholders make sense / list any missing shots  
- [ ] Notes / confusion points captured for doc edits  

---

## For IT / developers

Extension auth wiring and service keys: [`EXTENSION_ONBOARDING.md`](./EXTENSION_ONBOARDING.md).  
Deployment and hostnames: [`DEPLOYMENT.md`](./DEPLOYMENT.md).  
Architecture overview: [`ARCHITECTURE.md`](./ARCHITECTURE.md).
```

- [ ] **Step 2: Sanity-check against UI source (spot-check)**

Verify these claims still match code/docs before finishing:

| Claim | Check |
|-------|--------|
| Accept invitation route | `apps/core/app/routes.ts` → `/auth/accept-invitation` |
| Canvas in Settings | `settings-view.tsx` renders `CanvasIntegrationSettings` |
| Sync from Canvas on course/courses | `course-detail-manager-view.tsx` / `canvas-fetch-dialog.tsx` |
| App switcher | `packages/ui/src/app-launcher.tsx` (`BrandSwitcher` / `AppSwitcher`) |

If a label differs (e.g. button text), update the guide wording — do not invent screens.

- [ ] **Step 3: Grep for developer jargon**

```bash
rg -n "EDUAI_API_KEY|DATABASE_URL|npm run|localhost:3000|JWT|Prisma" docs/INSTRUCTOR_ONBOARDING.md
```

Expected: no hits in the instructor body (footer may link developer docs by filename only).

---

### Task 3: Screenshot drop-zone README

**Files:**
- Create: `docs/images/instructor-onboarding/README.md`

- [ ] **Step 1: Create the directory note**

```markdown
# Instructor onboarding screenshots

Drop PNG/WebP files here using the IDs from `docs/INSTRUCTOR_ONBOARDING.md`, for example:

- `core-dashboard-after-login.png`
- `canvas-connect-form.png`

After adding a file, replace the matching `> **Screenshot needed:**` block in the guide with:

```markdown
![Short alt text](./images/instructor-onboarding/<id>.png)
```

(Adjust the relative path if the image markdown lives in `docs/INSTRUCTOR_ONBOARDING.md` — use `images/instructor-onboarding/<id>.png`.)
```

---

### Task 4: Link from root README

**Files:**
- Modify: `README.md` (Docs table)

- [ ] **Step 1: Add a Docs table row**

In the Docs table near the top of `README.md`, add (after ARCHITECTURE or EXTENSION_ONBOARDING is fine):

```markdown
| [`INSTRUCTOR_ONBOARDING.md`](docs/INSTRUCTOR_ONBOARDING.md) | Pilot instructor guide — login, Canvas, Core course setup, AI Tutor, Question Maker |
```

Keep it clearly distinct from `EXTENSION_ONBOARDING.md` (developers).

- [ ] **Step 2: Verify the relative link**

From repo root, `docs/INSTRUCTOR_ONBOARDING.md` must exist (Task 2).

---

### Task 5: Verification pass

**Files:** all of the above

- [ ] **Step 1: Placeholder inventory complete**

```bash
rg -n "Screenshot needed:" docs/INSTRUCTOR_ONBOARDING.md
```

Expected: at least the 16 IDs from the spec (`invite-email-or-accept` … `qm-question-in-bank`).

- [ ] **Step 2: Internal links resolve**

`EXTENSION_ONBOARDING.md`, `DEPLOYMENT.md`, `ARCHITECTURE.md` linked from the footer must exist under `docs/`.

- [ ] **Step 3: Out-of-scope untouched**

Do not edit `docs/EXTENSION_ONBOARDING.md` content (link only from new guide). Do not add video assets.

- [ ] **Step 4: Do not commit plan/spec; commit guide only if user asks**

```bash
git status --short
```

Leave `docs/superpowers/` unstaged unless requested.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Single file `docs/INSTRUCTOR_ONBOARDING.md` | Task 2 |
| From-zero + production audience | Tasks 1–2 |
| Canvas in main path | Task 2 §3 |
| Core materials / enrollments / publish | Task 2 §4 |
| AI Tutor publish + enrollments | Task 2 §5 |
| QM happy path | Task 2 §6 |
| Stuck + limitations | Task 2 §7–8 |
| Screenshot placeholders | Task 2 + 3 |
| Walkthrough checklist | Task 2 §9 |
| Root README link | Task 4 |
| No commit of plan/spec | Header + Task 5 |
