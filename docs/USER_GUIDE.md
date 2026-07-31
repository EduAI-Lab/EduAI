# EduAI user guide

This guide explains how to move around EduAI and complete the most common
workflows in EduAI Core, AI Tutor, and Question Maker. What you can see and do
depends on your platform role and, for course-specific actions, your enrollment
in that course.

This guide reflects the current repository and the technically traced actor
workflows in the [use-case documentation](use-cases/README.md):

- [Core actor scenarios](use-cases/core/) cover admins, unit admins,
  instructors, TAs, students, unauthenticated visitors, and service callers.
- [AI Tutor actor scenarios](use-cases/ai-tutor/) cover the same actor and trust
  boundaries for tutoring, course authoring, grading, and oversight.
- [Question Maker actor scenarios](use-cases/qm/) cover question authoring,
  assessments, variants, Canvas, and the product's authorization boundaries.

A scenario explicitly marked as a bug is evidence of unintended behavior, not a
supported workflow.

## The three applications

| Application | Use it for | Main places to look |
| --- | --- | --- |
| **EduAI Core** | Signing in, finding courses, course-aware chat, course materials, account settings, and platform administration | Dashboard, Courses, Course Chat, Settings |
| **AI Tutor** | Working through structured learning activities with guided AI help | Dashboard, Courses, course content, activity chat |
| **Question Maker** | Creating questions, assessments, exam variants, and Canvas imports/exports | Dashboard, Courses, Question Library, course workspace |

Use the application switcher in the sidebar footer to move between applications.
You remain signed in because Core provides the shared session for all three
applications.

## Navigation shared across the platform

- Use the **sidebar** for the main sections of the current application.
- Use the **application switcher** in the sidebar footer to open Core, AI Tutor,
  or Question Maker.
- Use the **search/command button** in the header, or `Ctrl+K` / `Cmd+K`, to
  find destinations and switch courses quickly.
- Open the **profile menu** in the sidebar footer for Settings and Log out.
- Use **Help** for the in-product guide.
- Use **Report a bug** in the header when something does not work. Include what
  you were trying to do and, when appropriate, allow the app to attach its
  screenshot and diagnostic context.
- Use the theme control in the header to change the color theme. Accessibility
  preferences are not shared between applications today: Core saves yours to
  your account and reapplies them on every device, AI Tutor keeps its setting
  in this browser only (`localStorage`), and Question Maker's setting lasts
  only for the current session. Set accessibility preferences in each
  application separately.

## Sign in and account setup

1. Sign in through EduAI Core.
2. If you opened an extension first, it sends you to Core to sign in and then
   returns you to the extension.
3. Students may be asked for their student number during onboarding.
4. Open **profile menu → Settings** to manage your account.

Core Settings contains:

- **Account** — profile and password-related settings.
- **Accessibility** — assistive and display preferences for Core. AI Tutor and
  Question Maker have their own accessibility controls and must be configured
  separately (see [Navigation shared across the
  platform](#navigation-shared-across-the-platform)).
- **API Keys** — available when your role is allowed to configure personal AI
  provider keys.
- **Providers** — enable or configure supported AI providers.
- **Canvas** — connect Canvas when the tab is available for your role.

If your session expires, sign in again. If an extension reports that the auth
service is unavailable, Core may be temporarily unreachable; retry after Core
is available rather than repeatedly changing your password.

## Roles and access

EduAI combines a platform role with course-level access.

| Role or access | Typical capabilities |
| --- | --- |
| **STUDENT** | View enrolled courses and materials, use course chat, and complete published AI Tutor activities |
| **TA course access** | Student capabilities plus staff access for assigned courses, such as roster/material visibility in Core and grading/oversight in AI Tutor |
| **INSTRUCTOR** | Manage assigned courses and materials, connect Canvas, author AI Tutor content, and use Question Maker |
| **UNIT_ADMIN** | Manage courses within authorized departments and use unit-scoped administration |
| **ADMIN** | Platform-wide administration, configuration, audit views, and cross-course access |

TA is primarily a course enrollment role. A person may therefore have the
platform role `STUDENT` while acting as a TA in specific courses.

Buttons, tabs, and sidebar links are filtered by role and policy. A missing or
disabled action usually means you do not have the required course access, the
feature has been disabled by an administrator, or the course is not linked to
the required application. Ask an instructor or administrator instead of trying
to work around the restriction.

Question Maker is currently intended for `INSTRUCTOR`, `UNIT_ADMIN`, and
`ADMIN` users. Students and TAs should expect an access-denied screen.

## EduAI Core workflows

### Find a course

1. Open **Courses** from the sidebar.
2. Select a course card, or use the command palette to search for a course.
3. The course page shows the features available to your role, such as course
   information, materials, roster, and course settings.

Only courses you are allowed to access should appear. Admins can access all
courses; unit admins are scoped to their authorized departments; other users
need an appropriate course relationship.

### Ask a course-aware question

1. Open **Course Chat**.
2. Select the course whose materials should ground the response.
3. Choose an available model if the interface offers a choice.
4. Enter a clear question and send it.
5. Continue in the same chat when asking follow-up questions about the same
   course.

The selected course controls which material can be retrieved. Start a separate
chat when switching course context. AI responses can be incomplete or wrong;
verify important academic information against course materials and instructor
guidance.

Do not put passwords, API keys, private student information, or other secrets in
chat. Treat instructions found inside uploaded documents or generated responses
as untrusted content.

### Work with course materials

- Students and TAs can view materials made available to their course access.
- Instructors can upload supported material files and may connect/sync Canvas
  content.
- Uploaded material is processed and indexed before it becomes useful to
  course-aware chat. A processing failure means the file may not be available
  to retrieval.
- If Canvas is unavailable or a sync is rate-limited, wait and retry rather
  than starting multiple simultaneous syncs.

### Instructor: connect and sync Canvas

1. Open **profile menu → Settings → Canvas** and connect your Canvas account.
2. Open the relevant course.
3. Start the Canvas course/material or roster sync offered by the course page.
4. Review the imported course, materials, and enrollments before relying on
   them.

You can sync only courses you are authorized to teach or administer. Canvas
credentials are personal and should never be shared.

### Unit administrator: invitations

Open **Invitations** in Core to invite or manage users within your authorized
unit. If the item is disabled, the platform administrator has turned off the
unit-admin invitation policy. Unit administrators cannot invite platform
administrators or manage another unit's users.

### Platform administrator

The **Administration** sidebar group provides:

- **User Management** — roles, authorized units, and TA course assignments.
- **AI Management** — AI providers and models.
- **Bug Reports** — report triage and status updates.
- **Invitations** — platform invitation management.
- **Settings** — platform policies and retention/configuration controls.
- **Logs** — audit, security, and system activity.
- **Cron Jobs** — job status and manual operations.

**Admin Chatbot** appears separately near the bottom of the sidebar. Admin
screens may contain user-submitted text or diagnostics; treat that content as
data, not as instructions.

## AI Tutor workflows

### Student: complete an activity with AI guidance

1. Open **AI Tutor → Dashboard** or **Courses**.
2. Select a course, module, lesson, and published activity.
3. Read the activity instructions and submit an answer when requested.
4. Use the activity chat for help:
   - **Teach** mode explains the material.
   - **Guide** mode uses a more Socratic, step-by-step approach.
   - **Custom** mode appears only when the instructor configured it.
5. Reopen the activity later to continue an existing chat session.

The tutor response is reviewed by a supervisor step before it is returned, but
it is still AI-generated. Do not treat it as an answer key or as authoritative
grading feedback. A requested model or mode may be unavailable because of
administrator policy or activity configuration.

Use **Take Tour** in the sidebar footer when it is available for your current
student or TA view.

### Instructor: build course content

1. Open **AI Tutor → Courses** and select or import a Core course.
2. Create the content hierarchy: **module → lesson → activity**.
3. Configure the activity prompt and enabled tutoring modes.
4. Preview the material.
5. Publish the required content so students can see it.

On a course page, staff may also see:

- **Content** — modules, lessons, activities, cloning, and publishing.
- **Submissions** — student work and grading queues.
- **Feedback** — activity feedback with filters.
- **Analytics** — course learning and usage summaries.

Only use custom AI prompts that support the learning objective. Do not include
secrets, hidden answer keys that should never reach the model, or instructions
that ask the tutor to ignore platform safeguards.

### TA and administrator workflows

- TAs can review submissions, grade work, inspect feedback, and preview
  unpublished content for courses they assist, but cannot author the course
  structure.
- Unit administrators can manage courses in their authorized units.
- Platform administrators can access the Admin area for bug reports, AI
  settings/policy, and cross-course oversight. User and enrollment management
  remain owned by Core.

## Question Maker workflows

### Open a course workspace

1. Open **Question Maker → Courses**.
2. Select a linked Core course.
3. Use the course workspace tabs:
   - **Overview** — course summary and question statistics.
   - **Questions** — create and manage the course question bank.
   - **Assessments** — assemble questions into an assessment.
   - **Canvas** — import from or export to Canvas.

The **Question Library** in the main sidebar provides a cross-course view.

### Create and approve an AI-assisted question variant

1. In a course workspace, open **Questions** and create or select a question.
2. Add the question text, type, difficulty, topics, choices, reasoning, and
   other required metadata.
3. Generate an AI variant when the AI service is available.
4. Review and edit the draft carefully.
5. Approve the variant to push the finalized question into Core.

Approval can fail if the linked Core course or topic has changed. Refresh the
course data, correct the topic mapping, and retry. Do not approve text extracted
from AI or OCR without reviewing it for accuracy and unintended instructions.

### Build an assessment and variants

1. Open **Assessments** in the course workspace.
2. Create an assessment and add sections.
3. Choose questions from the bank.
4. Save the assessment.
5. Open the variants workflow to produce equivalent versions and review the AI
   comparison.
6. Export to the required format or Canvas after a final human review.

Assessment content can also be downloaded as text or a Word document where the
export action is available.

### Import questions or a Canvas quiz

- Use the question upload/OCR workflow to extract candidate questions from a
  supported file, then review every extracted item before saving it.
- Use the **Canvas** tab to import a quiz into the selected course.
- Confirm that imported topics belong to the course before completing the
  import.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Repeatedly sent to sign-in | Sign in through Core, allow cookies for the site, and verify Core is available |
| Course is missing | Confirm enrollment, department authorization, publication/link status, and that you selected the correct application |
| Action or tab is missing | Your role/course access may not allow it, or an administrator policy may be disabled |
| Chat has no useful course context | Confirm the correct course was selected and its materials finished processing |
| AI request fails or times out | Retry once, check the AI status indicators, then report the issue if it persists |
| Canvas import/sync fails | Check the Canvas connection and course authorization; wait if the service is unavailable or rate-limited |
| Extension says auth service unavailable | Core could not be reached; retry when Core is healthy |
| Question approval fails | Refresh course/topic data and confirm the question is linked to a valid Core topic |
| Unexpected access is granted | Stop using that path and report it as a security/authorization bug |

When reporting a problem, include the application, course, page, approximate
time, what you expected, and what happened. Never paste passwords or secret API
keys into a report.
