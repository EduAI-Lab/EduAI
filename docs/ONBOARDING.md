# Getting started checklist and page tours

Source of the in-app **Getting started** checklist and ▶ **Page tour** copy in Core, AI Tutor and Question Maker (#2004). What users see is described in the [user guide](USER_GUIDE.md#navigation-shared-across-the-platform).

Each `## <app>.<page>: Title` section is one page: `Task:` is the checklist label for students, `Staff task:` the label for everyone else (TAs included), and each numbered `**Step** — body` line is one tour step. Tour titles and bodies are plain text, so no Markdown. Each app has exactly five pages. Run `npm run onboarding:generate` after editing; CI runs `npm run onboarding:check` to catch stale generated copy. Routes and role access live in `packages/ui/src/onboarding/catalog.ts`.

The copy relies on these rules:

- Nothing starts a tour automatically. On the Core and Question Maker dashboards, ▶ plays the app's overview tour instead of a page from this file.
- Checklist progress is per account and app, in the browser only. Users tick tasks themselves; opening a page or finishing a tour never does.
- A checklist or tour never grants access. Question Maker's checklist and page tours show for instructors, unit admins and admins only.

## core.courses: Find your course

Task: Open an enrolled course

Staff task: Find your teaching course

1. **Choose a course** — Search or filter the course list, then open the right course. Students need an active enrollment and a published course.
2. **Create when permitted** — Instructors and administrators can use Create course when policy allows it. A new course starts as Draft; prepare it before publishing.

## core.course: Check your course

Task: Find your course chat

Staff task: Review the course's materials and topics

1. **Check the course** — Confirm the course code, section and instructors. Students use Chat about this course to ask about the learning materials.
2. **Prepare learning materials** — If you manage this course, upload learning materials and wait for Ready. Review topic matches and approve suggestions before students use them.
3. **Check access** — Course staff manage enrollments and publishing according to their permissions. A course must be published before enrolled students can see it.

## core.chat: Try course chat

Task: Ask a course-aware question

Staff task: Test a question against your course materials

1. **Choose the context** — Select the course before asking a question. Course Chat uses processed learning materials; Course Assistant is a separate staff tool for course administration.
2. **Ask and check** — Ask one clear question, then follow up in the same conversation. AI can be wrong; check important answers with your instructor or trusted learning resources.
3. **Attach when useful** — You can attach supported documents, code, spreadsheets or images to a message. Wait for extraction to finish; these attachments do not add files to the course library.

## core.settings: Set your preferences

Task: Review account and accessibility settings

Staff task: Review account settings and connect Canvas if needed

1. **Account and accessibility** — Use Account to change your password (students also link their student number) and Accessibility to set your Core preferences. Accessibility settings in the other apps are separate.
2. **Optional connections** — The available tabs depend on your role and platform policy. Instructors can connect Canvas when permitted. Keep provider keys and Canvas tokens private.

## core.help: Find help

Task: Find a guide and learn how to report a bug

Staff task: Find the instructor guide and reporting tools

1. **Read the guide** — Use Help for instructions matched to your role. Penny, when enabled, answers platform how-to questions from the indexed guides.
2. **Report a problem** — Use Report a bug under Help in the left navigation bar. Include the app, page, expected result and actual result; diagnostics are optional. Never include passwords or API keys.

## ai-tutor.courses: Open a course

Task: Open a published course

Staff task: Find your teaching course

1. **Find the course** — Courses come from Core. If one is missing, confirm access and publication there; allow time for sync before retrying.
2. **Choose your workspace** — Open a course from the list. The learner view shows published learning content; teaching and administration tools depend on your course access.

## ai-tutor.course: Explore course content

Task: Choose a module

Staff task: Review a module

1. **Follow the structure** — A course contains modules, each containing lessons and activities. Start with the module your instructor recommends.
2. **Prepare and publish** — Authors can add modules and publish content. Students see content only when the relevant course and parent content are published; TAs do not gain authoring permissions.

## ai-tutor.module: Open a lesson

Task: Choose a lesson

Staff task: Review a lesson

1. **Choose a lesson** — Lessons group activities within this module. Open a lesson to work through its activities or review its setup.
2. **Check visibility** — Authors should review the lesson and its activities before publishing. Students cannot see drafts; ask your instructor if expected content is missing.

## ai-tutor.lesson: Work through an activity

Task: Submit an answer and try guided help

Staff task: Review an activity's question and hints

1. **Read the activity** — Read the question and the instructions before answering. Staff can review the configured activity; instructors also choose its tutoring modes.
2. **Use guided help** — The tutor supports learning; it is not an answer key. Available modes depend on the activity and platform settings.
3. **Check your submission** — Submit your answer and check its status. Short answers without an answer key need staff review; an ungraded answer is not evidence that your response was wrong.

## ai-tutor.help: Find learning support

Task: Find the guide and reporting tools

Staff task: Find authoring and grading guidance

1. **Read role-specific help** — Help explains learner, authoring and grading workflows. Staff can use the course Submissions area when their access permits it.
2. **Report a problem** — Use Report a bug for broken behavior. Include the activity and what happened, without private student data or credentials.

## question-maker.courses: Find your course

Task: Open a course workspace

Staff task: Open a course workspace

1. **Choose the course** — Your courses come from Core; select the right course before creating content.
2. **Check access** — If a course is missing, confirm your Core course access and allow time for synchronization. TAs can add draft questions and variants; only staff can mark them reviewed or build assessments.

## question-maker.course: Explore the workspace

Task: Review the course workspace

Staff task: Review the course workspace

1. **Choose a workspace tab** — Overview summarizes the course. Questions and Banks hold its questions, Assessments groups them, and Canvas, shown when the course is linked to Canvas, offers supported import and export flows.
2. **Keep topics aligned** — Use course topics when organizing questions. If approval fails after a topic changes, refresh the course data and check the mapping.

## question-maker.question: Create a question

Task: Create and review a question

Staff task: Create and review a question

1. **Write the question** — Set the question text, type, difficulty, topics and the required answer details. Check the course and bank before saving.
2. **Review AI drafts** — AI-assisted content is a draft. Check correctness, reasoning and topic assignment before approving or sharing it.

## question-maker.assessment: Build an assessment

Task: Build and review an assessment

Staff task: Build and review an assessment

1. **Choose the scope** — Set the assessment topics when you want to restrict its scope. Questions outside those topics cannot be added while the restriction is active.
2. **Arrange and review** — Organize the sections and questions, then review the saved assessment and any generated variants.
3. **Export deliberately** — Use an available export action only after human review. Canvas export requires a working connection and access to the destination course.

## question-maker.library: Find saved questions

Task: Find your saved question in the library

Staff task: Find your saved question in the library

1. **Find reusable content** — The Question Library is a cross-course view. Search or filter to locate a question you can access.
2. **Check before reuse** — Review the question, answer and course/topic context before using it in another assessment. Reuse does not replace a correctness check.

