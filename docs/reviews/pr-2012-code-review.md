# Code Review — PR #2012

**docs + onboarding: weeks 5-7 docs refresh, Getting started checklist and on-demand page tours (#2003, #2004)**
Reviewed: 2026-10-19 · Scope: added code only (app/package code and generator; docs prose only where it feeds the UI) · Base: `development` · Head: `feat/2003-2004-docs-onboarding` (`0f94b6c2b`)

**Verdict: Request changes** — the checklist and page tours are wired up consistently in all three apps, but Core TAs are given checklist tasks their role can't do (R1). R2–R6 are non-blocking. Not verified by running the code.

---

## REQUEST CHANGES

### R1 — Core TAs get checklist tasks they can't do

**File:** `packages/ui/src/onboarding/catalog.ts` · line 61-62 (copy in `docs/ONBOARDING.md` · line 17, 26)

```ts
      // TAs get staff copy: their tasks open the teaching workspace.
      return { id, label: role === "STUDENT" ? page.task : page.staffTask, href };
```

```md
Staff task: Create or find your teaching course
...
Staff task: Prepare materials, topics and enrollments
```

**Comment to paste:**

```
On Core a TA gets `staffTask`, so their Getting started list reads "Create or find your teaching course" and "Prepare materials, topics and enrollments". A TA can't do either: `canCreateCourse` is ADMIN/UNIT_ADMIN (instructors only by policy), `canManageStudents` excludes `ta`, and topics are TA-only behind `taCanManageTopics`. The user guide says "Students and teaching assistants cannot create courses." A new TA opens the course page, finds no Create button or Enrollments controls, and has a task they can never honestly tick. The AI Tutor copy was rewritten for exactly this ("TAs do not gain authoring permissions"), and the test asserts it for AI Tutor only.

Suggest either a third `TA task:` line in ONBOARDING.md (generated like the others, chosen when role === "TA"), or rewording the two Core staff tasks so they hold for TAs too (e.g. "Find your teaching course", "Review the course's materials and topics").
```

---

## NON-BLOCKING

### R2 — The checklist's h2 comes before the page's h1, and it can't be dismissed

**File:** `apps/core/app/components/layout/core-app-shell.tsx` · line 175-182 (same in AI Tutor `_app.tsx` and QM `QmAppLayout.tsx`); `packages/ui/src/onboarding/onboarding.tsx` · line 62-69

```tsx
        {pathname === "/dashboard" && (
          <OnboardingChecklist
            platform="core"
            userId={user.id}
            role={user.role}
            navigate={navigate}
          />
        )}
        {children}
```

**Comment to paste:**

```
Non-blocking: the shell renders the checklist before `children`, so on every dashboard the first heading in the main region is `<h2>Getting started</h2>`, followed by the page's `PageHeading` h1 (a heading-order a11y issue, axe "heading-order"). It also sits above the dashboard's breadcrumb with its own `m-4`, outside the page's content container. It also never goes away: after all five tasks are ticked, the card stays at the top of the dashboard for good. Suggest letting each dashboard page render it below its heading (or exposing a slot), and collapsing or hiding it once `count === tasks.length`, or adding a "Hide" control stored under the same key.
```

---

### R3 — `hasSeenTour` on the tour context no longer has a reader

**File:** `packages/ui/src/tour/tour-provider.tsx` · line 44, 207-210

```ts
  hasSeenTour: (tourId: string) => boolean;
...
      hasSeenTour: (tourId) => {
        const tour = tours[tourId];
        return tour ? hasSeenTour(tour.storageKey) : true;
      },
```

**Comment to paste:**

```
Non-blocking: `useAutoStartTour` was the only consumer of the context's `hasSeenTour`. A grep of apps/ and packages/ (non-test) finds no other reader, and the new comments on `storageKey` say "nothing reads it to start tours". Suggest removing it from `TourContextValue` along with the default and provider implementation, and dropping the `hasSeenTour` export from `index.ts` if nothing outside uses it. Otherwise it's an API that suggests auto-start still exists. `markTourSeen` can stay if the record is still wanted.
```

---

### R4 — The generator rejects only bold text in step bodies

**File:** `scripts/generate-onboarding.mjs` · line 19-24

```js
  const steps = lines.flatMap((line) => {
    const step = line.match(/^\d+\. \*\*(.+)\*\* — (.+)$/);
    // Tour cards render plain text, so Markdown would show as literal asterisks.
    if (step?.[2].includes("**")) throw new Error(`Markdown in tour step body: ${id}`);
    return step ? [{ id: `${id}.${step[1]}`, title: step[1], body: step[2] }] : [];
  });
```

**Comment to paste:**

```
Non-blocking: the header of ONBOARDING.md says "Tour titles and bodies are plain text, so no Markdown", but the check only catches `**`. A step body with `code`, a [link](x), or _emphasis_ passes `onboarding:check` and shows literal backticks or brackets on the tour card. Also, `(.+)` in the title is greedy, so a body containing `** — ` would be misparsed instead of rejected. A numbered line that doesn't match the pattern at all (e.g. a missing em dash) is silently skipped rather than reported. Suggest a non-greedy title `(.+?)`, rejecting any of `` ` ``, `[`, `_`, `*` in title or body, and throwing on a `^\d+\. ` line that doesn't match.
```

---

### R5 — Page tours run without a TourProvider guard

**File:** `packages/ui/src/onboarding/onboarding.tsx` · line 132-140, 155-160

```tsx
function PageTour({ pageId }: { pageId: OnboardingPageId }) {
  const [open, setOpen] = React.useState(false);
  const page = ONBOARDING_PAGES[pageId];
  return (
    <>
      <PlayButton title={`Tour: ${page.title}`} onClick={() => setOpen(true)} />
      <LocalTour steps={page.steps} open={open} onOpenChange={setOpen} portal />
    </>
  );
}
```

**Comment to paste:**

```
Non-blocking: a page tour is a `LocalTour` with its own `open` state, separate from `TourProvider`. If the overview tour is running (started from (?) or Help) and the user presses ▶ Page tour, both overlays mount, each with a `fixed inset-0 z-[1000]` layer, and the two compete for focus and Escape. Suggest disabling the ▶ button while `useTour().isRunning`, or having `PageTour` close any running provider tour first. Separately, the generated steps carry no `target`, so every page-tour card is centred with nothing highlighted. If that's intentional, a line in ONBOARDING.md would save the next editor from wondering why `target` is never set.
```

---

### R6 — `DIRECT_PAGES` is linked to page ids only by name

**File:** `packages/ui/src/onboarding/catalog.ts` · line 9, 59-60

```ts
const DIRECT_PAGES = new Set(["help", "settings", "chat", "library"]);
...
      const name = id.split(".")[1];
      const href = DIRECT_PAGES.has(name) ? `/${name}` : courses;
```

**Comment to paste:**

```
Nit: `resolveOnboardingPage` is type-checked against the generated ids, but the checklist hrefs are not. Rename `question-maker.library` to `question-maker.bank` in ONBOARDING.md and the generator still passes, TypeScript catches the route matcher, and the checklist's "Open" quietly sends the user to `/courses` instead. Suggest an explicit `Partial<Record<OnboardingPageId, string>>` of hrefs (e.g. `{ "core.chat": "/chat", "question-maker.library": "/library", ... }`) so a rename is a type error here too.
```
