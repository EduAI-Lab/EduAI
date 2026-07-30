# Instructor onboarding screenshots

Drop zone for PNG screenshots referenced by [`INSTRUCTOR_ONBOARDING.md`](../../INSTRUCTOR_ONBOARDING.md).

## Naming

Save each screenshot as `<id>.png` in this directory, where `<id>` matches the backtick ID in the guide’s placeholder block (for example `core-sign-in.png`).

## Screenshot IDs

| ID | Section | What to capture |
|----|---------|-----------------|
| `invite-email-or-accept` | 2 | Invitation email or accept-invitation page |
| `core-sign-in` | 2 | Core sign-in page |
| `core-dashboard-after-login` | 2 | Core dashboard after login |
| `canvas-connect-form` | 3 | Settings → Canvas connection form |
| `canvas-sync-courses` | 3 | Sync-from-Canvas dialog and/or courses list |
| `core-course-detail-tabs` | 4 | Course detail with tabs visible |
| `core-materials` | 4 | Materials tab |
| `core-enrollments` | 4 | Enrollments tab |
| `core-publish` | 4 | Publish / unpublish control |
| `app-switcher` | 5 | App switcher open (Core / AI Tutor / Question Maker) |
| `aitutor-instructor-home` | 5 | AI Tutor instructor home |
| `aitutor-publish-module-lesson` | 5 | Module or lesson publish toggle |
| `aitutor-enrollments-panel` | 5 | AI Tutor enrollments panel |
| `qm-course-picker` | 6 | Question Maker course picker / link UI |
| `qm-generate-questions` | 6 | Generate-questions UI |
| `qm-question-in-bank` | 6 | Question bank with generated item visible |

## Replacing placeholders in the guide

In [`INSTRUCTOR_ONBOARDING.md`](../../INSTRUCTOR_ONBOARDING.md), each screenshot slot is a blockquote like:

```markdown
> **Screenshot needed:** `core-sign-in`
> Capture: Core sign-in page.
> Show: Sign-in options visible (CWL/OAuth or email as deployed).
```

After you add `core-sign-in.png` here, **delete that entire blockquote** and insert a markdown image on its own line:

```markdown
![Core sign-in page](images/instructor-onboarding/core-sign-in.png)
```

Paths are relative to `docs/` (the guide lives alongside the `images/` folder). Use a short alt text that describes what the reader should see.

Repeat for every ID in the table above until no `> **Screenshot needed:**` blocks remain in sections 2–6.
