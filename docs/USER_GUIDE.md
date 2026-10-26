# EduAI user guide

This guide explains how to move around EduAI and complete the most common workflows in EduAI Core, AI Tutor, and Question Maker. What you can see and do depends on your platform role and, for course-specific actions, your enrollment in that course.

Setting up a course for the first time? Follow the step-by-step [instructor onboarding walkthrough](INSTRUCTOR_ONBOARDING.md) instead, then come back here as a reference.

This guide reflects the current repository and the technically traced actor workflows in the [use-case documentation](use-cases/README.md):

- [Core actor scenarios](use-cases/core/) cover admins, unit admins, instructors, TAs, students, unauthenticated visitors, and service callers.
- [AI Tutor actor scenarios](use-cases/ai-tutor/) cover the same actor and trust boundaries for tutoring, course authoring, grading, and oversight.
- [Question Maker actor scenarios](use-cases/qm/) cover question authoring, assessments, variants, Canvas, and the product's authorization boundaries.

A scenario explicitly marked as a bug is evidence of unintended behavior, not a supported workflow.

## The three applications

| Application | Use it for | Main places to look |
| --- | --- | --- |
| **EduAI Core** | Signing in, finding courses, course-aware chat, course materials, account settings, and platform administration | Dashboard, Courses, Course Chat, Settings |
| **AI Tutor** | Working through structured learning activities with guided AI help | Dashboard, Courses, course content, activity chat |
| **Question Maker** | Creating questions, assessments, exam variants, and Canvas imports/exports | Dashboard, Courses, Question Library, course workspace |

Use the app switcher, the current app's icon at the top of the left navigation bar, to move between applications. On a phone it sits in the top bar next to the menu button.
You remain signed in because Core provides the shared session for all three applications.

## Navigation shared across the platform

- Use the **navigation bar** on the left for the main sections of the current application; on a phone, open it with the menu button in the top bar.
- Use the **app switcher** (the app icon at the top of the left navigation bar, or in the top bar on a phone) to open Core, AI Tutor, or Question Maker.
- Use the **search/command button** in the header, or `Ctrl+K` / `Cmd+K`, to find destinations and switch courses quickly.
- Open **Account** in the left navigation bar for Settings and Log out.
- Use **Help** for the in-product guide. Some controls also have a small **(i)**: hover over or focus it for a one-line summary, or select it for a short explanation linking to the matching Help section.
- Each app's dashboard has a five-task **Getting started** checklist. **Open** takes you to a task; tick it yourself when you have finished. Progress is saved for your account in this browser only.
- Five main pages in each app have a ▶ **Page tour** button in the header. Tours start only when you press it. On the Core and Question Maker dashboards, ▶ plays the app's overview tour, the same one **(?) → Take the tour** offers. Question Maker's checklist and page tours are for instructors and administrators.
- Use **Report a bug** under **Help** in the left navigation bar (in the menu on a phone) when something does not work. Core, AI Tutor, and Question Maker all open the same form. Include what you were trying to do.
- Diagnostics are opt-in in every app: turn on **Include diagnostics** to attach recent console and request logs, the page address, and a screenshot of the page (the bug-report form itself is left out). With it off, nothing but your description, bug type, and anonymity choice is sent.
- Use the theme control in the header to change the color theme. Accessibility preferences are not shared between applications today: Core saves yours to your account and reapplies them on every device, AI Tutor keeps its setting in this browser only (`localStorage`), and Question Maker's setting lasts only for the current session. Set accessibility preferences in each application separately.

## Ask Penny, the help assistant

When an administrator has turned it on, **Penny** sits in the bottom-right corner of every page in EduAI Core, AI Tutor and Question Maker. On Core's chat pages and AI Tutor lessons it moves to an **Ask Penny** button in the header so it does not cover the message box. Your conversation is kept separately in each app.

- Ask how to do something in EduAI — for example "How do I join a course?" or "How do I report a bug?". Penny answers from the user guide and instructor onboarding guide, filtered to your role, and links the guide pages it used.
- Inside a course, Penny can also answer questions about that course's materials. Staff previewing a material can choose **Ask Penny about this** to ask about that file. The panel header always says which course or material it is looking at.
- Platform how-to questions still work inside a course: Penny always searches the guide as well.
- If the guide does not cover your question, Penny says so instead of guessing. If it says it is temporarily unavailable, the search service is down; try again later.
- Conversations are kept only in this browser tab. Opening a different course or material starts a new conversation.
- Open the **gear** in Penny's header to choose which AI provider and model answer you, or to save your own API key for that provider. A saved key is never shown again — only its last four characters. Penny never accepts a key typed into a question. In AI Tutor and Question Maker the gear links to Core, where these settings are changed.

Penny is a guide, not an answer key: for assessment-style questions it explains the approach rather than handing over a solution.

## Sign in and account setup

1. New to EduAI? Open your invitation email, or choose **Sign up** on the Core sign-in page. When registration is invite-only there is no Sign up link; ask your instructor or administrator for an invitation. Confirm your email address from the message EduAI sends.
2. Sign in through EduAI Core. Students see their courses once an instructor adds them or the course roster syncs; until then the dashboard says your professor hasn't added you yet.
3. If you opened an extension first, it sends you to Core to sign in and then returns you to the extension.
4. Students may be asked for their student number during onboarding.
5. Open **Account → Settings** to manage your account.

Core Settings contains:

- **Account** — change your password; students also link their student number here.
- **Accessibility** — assistive and display preferences for Core. AI Tutor and Question Maker have their own accessibility controls and must be configured separately (see [Navigation shared across the platform](#navigation-shared-across-the-platform)).
- **API Keys** — for administrators, and for anyone an administrator has given API access (see [API access for students and researchers](#api-access-for-students-and-researchers)).
- **Providers** — enable or configure supported AI providers.
- **Canvas** — connect Canvas when the tab is available for your role.

Forgot your password? Choose **Forgot your password?** on the sign-in page. EduAI emails you a 6-digit code to enter with your new password.

If your session expires, sign in again. If an extension reports that the auth service is unavailable, Core may be temporarily unreachable; retry after Core is available rather than repeatedly changing your password.

## Roles and access

EduAI combines a platform role with course-level access.

| Role or access | Typical capabilities |
| --- | --- |
| **STUDENT** | View enrolled published courses, use course chat, and complete published AI Tutor activities |
| **TA course access** | Student capabilities plus staff access for assigned courses, such as roster/material visibility in Core and grading/oversight in AI Tutor |
| **INSTRUCTOR** | Manage assigned courses and materials, connect Canvas, author AI Tutor content, and use Question Maker |
| **UNIT_ADMIN** | Manage courses within authorized departments and use unit-scoped administration |
| **ADMIN** | Platform-wide administration, configuration, audit views, and cross-course access |

TA is primarily a course enrollment role. A person may therefore have the platform role `STUDENT` while acting as a TA in specific courses.

Buttons, tabs, and sidebar links are filtered by role and policy. A missing or disabled action usually means you do not have the required course access, the feature has been disabled by an administrator, or the course is not linked to the required application. Ask an instructor or administrator instead of trying to work around the restriction.

Question Maker is for `INSTRUCTOR`, `UNIT_ADMIN`, and `ADMIN` users. A TA can open the courses they assist, add questions and AI variants and edit the ones they wrote, but their work stays a draft until staff mark it reviewed. TAs cannot build assessments or use Canvas. Students see an access-denied screen.

## EduAI Core workflows

### Find a course

1. Open **Courses** in the left navigation bar and pick the course, or choose **All courses** to see them all.
2. Select a course card, or use the command palette to search for a course.
3. The course page shows the features available to your role, such as course information, materials, roster, and course settings.

Only courses you are allowed to access should appear. Admins can access all courses; unit admins are scoped to their authorized departments; other users need an appropriate course relationship.

### Who can create a course

Students and teaching assistants can't create courses. If you need a course set up, ask your instructor or a unit administrator. Courses are created by instructors, unit administrators and platform administrators, or brought across from Canvas.

### Create a new course

Platform administrators, unit administrators, and instructors can make a new course by hand:

1. Open **Courses** in the left navigation bar and choose **All courses**.
2. Choose **Create course** at the top right of the page.
3. Fill in the **Course name**, pick a **Course Code** (the department or subject, such as `CS`), and enter the **Course number** (such as `101`) and **Section**.
4. Pick a **Start date**. The **Term** is filled in from the start date; you can't choose it separately.
5. Administrators and unit administrators also choose the course's **Instructor**. When an instructor creates a course, they become its instructor automatically.
6. Optionally add **AI instructions** for the course's AI features, then choose **Create course**.

The new course starts **Unpublished**, so students can't see it yet. Add materials and enrollments, then publish it from the course card or the course page.

If a deleted course has the same code, section, year and term, or the same instructor already teaches that code in another section, year or term, EduAI first shows **This course may already exist**. **Restore** brings the deleted course back with its materials and enrollments; Question Maker and AI Tutor content is not restored. If you can't restore it, the dialog tells you to ask an administrator. **Create new course anyway** makes a separate course.

Who can create where:

- Unit administrators can only create courses under the course codes they are authorized for. If you have no authorized course codes, the button is disabled.
- Instructors can create courses only while an administrator leaves **Instructors can create courses** turned on. When it is off, the button stays visible but greyed out, with a tooltip explaining why.

If your course already exists in Canvas, you don't need to create it by hand: fetch it from Canvas instead (see **Instructor: connect and sync Canvas**). That brings across the course details and lets you sync materials and the roster.

### Ask a course-aware question

1. Open **Course Chat**.
2. Select the course whose materials should ground the response.
3. Choose an available model if the interface offers a choice.
4. Enter a clear question and send it.
5. Continue in the same chat when asking follow-up questions about the same course.

Use the attachment control to add up to three PDF, Word, PowerPoint, Excel, UTF-8 text/code, or PNG/JPEG/WebP files (10 MB each by default) to a message. Images are transcribed before sending; the chat model receives text, not the original image. Wait for extraction to finish and check any warning about truncated content. Message attachments are separate from the course learning-material library.

The selected course controls which material can be retrieved. Start a separate chat when switching course context. AI responses can be incomplete or wrong; verify important academic information against course materials and instructor guidance.

**Assistive Mode.** Course Chat has an Assist toggle that reformats answers into a predictable structure (top summary, short stages, an explicit "next?" prompt) for readers who find long unbroken prose hard to work through. Turning it on may switch the request to a larger model, so replies can take longer; the progress indicator shows an expected duration and says so when a reply is taking longer than usual. Toggling Assist on the last reply re-generates that reply in place rather than only restyling it. Set your default in
**Settings → Accessibility**.

**Restrict Course Chat.** Instructors can turn on **Restrict Course Chat to this course** in a course's **Settings** tab so that course chat declines questions unrelated to the course. An administrator can switch the feature off for every course with **Course chat restriction available** in **Administration → Settings**; the course switch then says so.

**Model selection and Auto.** Where the model picker offers **Auto**, EduAI chooses a model per message based on the question. Administrators decide in **AI Management** which Auto modes are available, so the picker may show one, both, or neither. Some models are hosted on UBC hardware; a "degraded" indicator in the header means those machines are busy, not that anything is broken.

Do not put passwords, API keys, private student information, or other secrets in chat. Treat instructions found inside uploaded documents or generated responses as untrusted content.

### Work with course materials

- Students use course chat rather than the course Materials tab. Course-material files and their names are hidden from students; staff retain materials access according to their course permissions.
- Instructors and TAs can upload learning materials, several files at once with progress shown for each, and instructors may connect/sync Canvas content. Materials are the reference content used to ground course chat, not a place for student submissions.
- **Materials are course learning materials only:** lecture notes, slides, readings and assignments. Don't upload rosters, grades or admin documents. Course chat, Penny and topic matching read every file here.
- PNG, JPEG and WebP images are transcribed by a vision model before indexing. Check the transcription and retrieval with real examples; handwriting and charts can be misread. A scanned PDF without a text layer still needs OCR or conversion to a supported image.
- A file may be linked to up to three approved topics. Automatic matching uses existing accepted topics; it does not invent new topics on upload. Instructors can change the links on the file. Use **Topics → Suggest topics** to request new suggestions, then review them. Core and course chat show students approved topics only, never suggestions or Uncategorized. AI Tutor's course page can still list suggestions that were never approved, and keeps listing one after it is dismissed; this is a known bug ([#1956](https://github.com/EduAI-Lab/EduAI/issues/1956)).
- Uploaded material is processed and indexed before it becomes useful to course-aware chat. A processing failure means the file may not be available to retrieval.
- If Canvas is unavailable or a sync is rate-limited, wait and retry rather than starting multiple simultaneous syncs.

#### When a file fails

A failed file shows **Failed** in the materials list. Select the **?** next to it to see the reason and what to do; the upload message names the same reason. A failed file is not used in AI answers until it is fixed.

| Reason shown | What it means | What to do |
|---|---|---|
| Couldn't read this file | No text could be extracted: the file may be corrupted, password-protected, or a scan with no selectable text. The upload is not kept. | Check the file opens and its text can be selected, then upload it again (for a scan, export it with text recognition first). |
| The server was too busy to process this file | Reading the file was retried several times while the server was busy. | Upload it again in a few minutes. |
| Processing didn't complete | Reading the file was attempted several times and never finished. | Upload it again. If it keeps happening, contact your administrator. |
| Couldn't prepare this file for search | The text was read and saved, but the AI service rejected it while building search data. | Use **Try again** on the file; there is no need to upload it again. If it keeps failing, contact your administrator. |
| Rate-limited while indexing | The AI service was limiting requests while building search data. The text is saved. | Use **Try again** in a few minutes. |
| AI service unavailable while indexing | The AI service didn't respond while building search data. The text is saved. | Use **Try again** later. If it keeps happening, contact your administrator. |
| This file is already on the course | The same content is already uploaded to this course, so nothing was added. | Remove the extra entry; nothing else is needed. |

Uploading the same file again after a failure retries the existing entry rather than adding a second copy, so it is safe to re-upload. Deleting a failed file and uploading it again also retries it.

### Instructor: connect and sync Canvas

1. Open **Account → Settings → Canvas** and connect your Canvas account.
2. Open the relevant course.
3. Start the Canvas course/material or roster sync offered by the course page.
4. Review the imported course, materials, and enrollments before relying on them.

You can sync only courses you are authorized to teach or administer. Canvas credentials are personal and should never be shared.

### Instructor: add students in bulk or by link

Two ways to enroll people beyond adding them one at a time, both on a course's **Enrollments** tab.

**Upload a roster CSV.** The file needs a header row. Only one column is required:

| Column | Required | Values |
|---|---|---|
| `email` | yes | the person's EduAI account email |
| `role` | no | `STUDENT`, `TA` or `INSTRUCTOR` — defaults to `STUDENT` |

Any other columns (`name`, `student_id`, and so on) are ignored, so a roster exported from elsewhere usually works unchanged. Headers are matched case-insensitively, and Excel's byte-order mark, Windows line endings and quoted fields are all handled.

Limits are **500 rows** and **256 KiB** per upload; split a larger roster into batches.

The import is **not all-or-nothing**. Each row is processed on its own and you get a summary naming the line number of anything that failed — so a 100-row file with three bad addresses enrolls 97 people and tells you about the other three. Someone already enrolled is reported as already enrolled rather than as an error, so re-uploading last week's roster is safe. A row is rejected if the email has no EduAI account yet, or if it asks for a role you cannot grant: instructors may add students and TAs, but only administrators may add another instructor.

**Share a self-enrollment link.** Generate a link and students who open it join the course themselves. The link is scoped to that one course, expires, can be revoked at any time, and can carry a maximum number of uses. It only ever enrolls people as **students** — there is no way to grant staff access through a link, however it is shared. A student who doesn't have an EduAI account yet can create one straight from the link: they're added to the course as soon as they verify their email (or immediately after signup when verification is disabled), as long as the link still works then. Students who still need to link their student number see that step before continuing into the course. If it has expired, been revoked or reached its limit in the meantime, they're told so and asked to get a new one from you.

The full link is shown **once**, when you create it. Copy it then; EduAI stores only a hash afterwards and cannot show it again. Treat it like a password: anyone holding it can join the course. If it leaks, revoke it and generate a new one.

### Instructor: the Course Assistant

Once you teach at least one published course, a second chat entry, **Course Assistant**, appears below Course Chat in the navigation bar, whatever your platform role.
It is a read-only helper for *running* one of your published courses — it can answer questions about that course's roster, enrollments, and topics, and nothing else.

1. Open **Course Assistant** and pick one of your published courses.
2. Ask about the roster or topics — for example "who enrolled in the last 7 days?" or "list the topics defined for this course".

What it deliberately cannot do: reach another course, look up platform users, triage bug reports, search course materials, or change anything. It is not a tutoring assistant; use Course Chat for that.

### Instructor and unit administrator: chat oversight

Where an administrator has enabled it, instructors can review the course chats for a course they teach, and unit administrators can review chats across their authorized departments.
Both are governed by platform policy flags, so the view may be unavailable even when your role would otherwise allow it. Treat chat transcripts as student personal information.

### Unit administrator: invitations

Open **Invitations** in Core to invite or manage users within your authorized unit. If the item is disabled, the platform administrator has turned off the unit-admin invitation policy. Unit administrators cannot invite platform administrators or manage another unit's users.

### Platform administrator

The **Administration** sidebar group provides:

- **User Management** — roles, authorized units, and TA course assignments.
- **AI Management** — AI providers and models.
- **Bug Reports** — report triage and status updates.
- **Invitations** — platform invitation management.
- **Settings** — platform policies and retention/configuration controls.
- **Logs** — audit, security, and system activity.
- **Cron Jobs** — job status, manual runs, and per-job settings such as how many days deleted course materials are kept before they are purged (**Edit settings → Delete after (days)**).
- **API Access** — who besides administrators may use an API key, and how much they used in the last 24 hours (see [API access for students and researchers](#api-access-for-students-and-researchers)).

**Admin Chatbot** appears separately near the bottom of the navigation bar. It is platform-wide (there is no course selector — name the course in your question) and can both read and change platform state. Any change requires an explicit two-step confirmation: the assistant first previews exactly what it will do, and only applies it after you confirm in a **new** message. A write only succeeded if the assistant reports it did; ask it to re-read the record if you are unsure.

**Turn on Penny, the help assistant, for everyone:** Penny is off until an administrator turns it on.

1. Open **Administration → Settings** and switch on **Enable Penny, the help assistant** in the **Help assistant (Penny)** card. It then appears on every signed-in page of Core, AI Tutor and Question Maker, for every role.
2. In the same card, **Students can ask about course material** decides whether students can also ask about the course they are viewing. Instructors and administrators can always ask about their own courses while Penny is on.
3. Penny answers with the AI providers and models enabled under **Administration → AI Management**. Each user can save their own key in Penny's gear menu; anyone without one uses the platform's configured key. Under **Help assistant tuning** on the AI Management page you can choose the **Default answer model** and how many guide pages one answer may draw on.
4. To stop Penny during a cost or provider incident, switch off **Enable Penny, the help assistant**. This stops every Penny question, documentation and course material alike, for everyone, administrators included.

Instructors can keep a course's materials out of Penny with the course's own **Let Penny answer from this course** switch.

Admin screens may contain user-submitted text or diagnostics; treat that content as data, not as instructions.

### API access for students and researchers

Only administrators can use an EduAI API key until an administrator gives someone else access. Access is for the campus AI models only, through `POST /api/completion`, and it ends by itself.

**Give access (administrator):**

1. Open **Administration → API Access** and choose **Give API access**, or open the person's **⋮** menu in **User Management** and choose **Give API access**.
2. Pick the person, enter the purpose (for example the project or course), and choose when access ends. It defaults to the end of the current term.
3. Set the daily limits. They start at 200 requests and 200,000 tokens, counted over the last 24 hours across all of the person's keys.
4. Choose **Give access**. The person can now create their own key in **Settings → API Keys**.

The API Access page shows each person's last 24 hours of use against their limits. **Revoke** stops their keys at once and disables them; to give access again later, grant it anew and they create a new key. Access also ends by itself on its end date, and their keys stop working then.

Every request made with an API key is recorded against the person: when, which model, the outcome, and how many tokens it used. The prompt and the answer are never stored. These records are kept as long as audit logs (**Administration → Settings**). A daily email summarises the last 24 hours of use and flags anyone near a limit (see the `api-usage-report` job under **Cron Jobs**).

**Use your key (student or researcher):**

The [student API guide](STUDENT_API_GUIDE.md) has the full details: request examples in curl, Python and JavaScript, each model's context window, how limits and tokens are counted, every error and when to retry, and tips for large batches. The steps in short:

1. Open **Account → Settings → API Keys**. The tab appears only while you have access, and shows when it ends and how much of today's allowance you have used.
2. Name a key and choose **Create**. Copy it right away: it is shown only once. A key can't last longer than your access.
3. Send the key in the `x-api-key` header to `POST /api/completion` with a campus model, for example `vllm:qwen3.5-2b-instruct`. The tab shows a complete example.

Terms of use:

- Keep your key private. Don't commit it to a repository, paste it in a shared notebook, or give it to anyone. If it leaks, delete it in **Settings → API Keys** and create a new one.
- Don't send participant or personal data unless your ethics approval covers processing it on UBC's EduAI servers.
- Use stays within your daily limits. Course chat comes first: when the campus models are busy, your request may be turned away for a few seconds.
- Every request is recorded against your account (not its content), and administrators review use.

What an API response means:

| Response | Meaning | What to do |
|---|---|---|
| `403` "this account has no active API access" | Your access ended or was revoked | Ask the administrator who gave you access |
| `403` `API_ACCESS_MODEL_NOT_ALLOWED` | The model isn't a campus model | Use a `vllm:` model |
| `429` `API_ACCESS_LIMIT` | You reached your daily request or token limit | Wait for the `Retry-After` seconds; use frees up as requests pass 24 hours old |
| `503` `API_ACCESS_BUSY` or `AI_ADMISSION_TIMEOUT` | The campus models are busy | Retry after `Retry-After` seconds |
| `400` `CONTEXT_LENGTH_EXCEEDED` | Your prompt plus `maxTokens` is longer than the model allows | Shorten the prompt or lower `maxTokens` |

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

The tutor response is reviewed by a supervisor step before it is returned, but it is still AI-generated. Do not treat it as an answer key or as authoritative grading feedback. A requested model or mode may be unavailable because of administrator policy or activity configuration.

For a guided tour, open the **(?)** help button in the page header and choose **Take the tour**. It is offered to students and TAs, and to unit administrators. Every app (Core, AI Tutor and Question Maker) starts its tour from the same button.

### Instructor: build course content

1. Open **AI Tutor → Courses** and select a course synced from Core.
2. Create the content hierarchy: **module → lesson → activity**.
3. Configure the activity prompt and enabled tutoring modes.
4. Preview the material.
5. Publish the required content so students can see it.

On a course page, staff may also see:

- **Content** — modules, lessons, activities, cloning, and publishing.
- **Submissions** — student work and grading queues.
- **Feedback** — activity feedback with filters.
- **Analytics** — course learning and usage summaries.

Only use custom AI prompts that support the learning objective. Do not include secrets, hidden answer keys that should never reach the model, or instructions that ask the tutor to ignore platform safeguards.

### TA and administrator workflows

- TAs can review submissions, grade work, inspect feedback, and preview unpublished content for courses they assist, but cannot author the course structure.
- Unit administrators can manage courses in their authorized units.
- Platform administrators can access the Admin area for bug reports, AI settings/policy, and cross-course oversight. User and enrollment management remain owned by Core.

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

On the **Questions** tab, and in the Question Library once a course is picked, you can filter by **Bank**. A question card's menu offers **Move to bank…** and **Add to bank…**; banks that already hold the question can't be picked.

### Create and approve an AI-assisted question variant

1. In a course workspace, open **Questions** and create or select a question.
2. Add the question text, type, difficulty, topics, choices, reasoning, and other required metadata.
3. Generate an AI variant when the AI service is available. For a new question you can set **Number of questions** (1–10) to get several drafts at once, then go through them: **Save & next** saves a draft and **Discard draft** skips it.
4. Review and edit the draft carefully.
5. Approve the variant to push the finalized question into Core.

Approval can fail if the linked Core course or topic has changed. Refresh the course data, correct the topic mapping, and retry. Do not approve text extracted from AI or OCR without reviewing it for accuracy and unintended instructions.

### Build an assessment and variants

1. Open **Assessments** in the course workspace.
2. Create an assessment and add sections.
3. Choose the assessment’s course topics if you want to limit its scope, then choose questions from the bank. Off-topic questions cannot be added while that restriction is in place.
4. Save the assessment.
5. Open the variants workflow to produce equivalent versions and review the AI comparison.
6. Export to the required format or Canvas after a final human review.

Assessment content can also be downloaded as text or a Word document where the export action is available.

### Import questions or a Canvas quiz

- Use the question upload/OCR workflow to extract candidate questions from a supported file, then review every extracted item before saving it.
- Use the **Canvas** tab to import a quiz into the selected course.
- Confirm that imported topics belong to the course before completing the import.

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

When reporting a problem, include the application, course, page, approximate time, what you expected, and what happened. Never paste passwords or secret API keys into a report.
