# EduAI instructor onboarding

**Who this is for:** Instructors joining the EduAI pilot.
**What you will do:** Create your account, connect Canvas, set up a course in Core, then try AI Tutor and Question Maker.
**How long it takes:** About 20–30 minutes, once.

This is a guided first-run walkthrough. For a full reference on every screen, role, and workflow across the three apps, use the [user guide](USER_GUIDE.md) instead.

## Where to sign in

| App | Production | Pilot / dev |
|-----|-----------|-------------|
| EduAI (Core) | https://my.eduai.ok.ubc.ca | https://dev.eduai.ok.ubc.ca |
| AI Tutor | https://aitutor.eduai.ok.ubc.ca | https://dev.aitutor.eduai.ok.ubc.ca |
| Question Maker | https://questionmaker.eduai.ok.ubc.ca | https://dev.questionmaker.eduai.ok.ubc.ca |

Ask your pilot coordinator which of the two sets applies to you — most pilot participants are on the `dev.` hosts.

You sign in once on Core, and the other two apps reuse that session in the same browser. Move between them with **Switch app** at the bottom of the sidebar.

---

## 1. Welcome

EduAI has three parts:

1. **Core** — courses, materials, enrollments, course-aware chat, and the Canvas connection. This is where course and roster changes are made first.
2. **AI Tutor** — modules, lessons, activities, and tutoring chat for students.
3. **Question Maker** — question banks, AI-assisted question variants, and assessments.

This guide walks a **happy path** from your invitation email through a first useful setup in each app. Troubleshooting is at the end.

Throughout, the Core sidebar holds **Dashboard**, **Courses**, and **Course Chat**, with **Help & guide**, **Switch app**, and your profile menu pinned at the bottom. The header has search (`Ctrl+K` / `Cmd+K`), a platform status indicator, the theme control, and **Report a bug**.

---

## 2. Get an account

### Accept your invitation

Your admin (or unit admin) sends an invitation email. Open the link and set your password when prompted. The link opens Core's `/auth/accept-invitation` page.

### Sign in

Go to your Core host from the table above and sign in.

### Land on your dashboard

After sign-in you land on **Dashboard**. It shows four counters across the top — courses teaching, students enrolled, materials uploaded, and AI interactions — plus a **Material status** panel breaking your files into Ready, Processing, and Failed, a **Your courses** list, recent conversations, and a **Canvas courses** card at the bottom.

**If you're stuck:** The invite link expired — ask your admin to resend. Wrong role (for example Student) — ask them to re-invite you as **Instructor**.

---

## 3. Connect Canvas and fetch courses

Canvas is how most pilot courses enter EduAI.

### Create a Canvas access token

Do this in Canvas, not in EduAI:

1. Open the Canvas global navigation on the left, choose **Account**, then **Settings**.
2. Scroll to **Approved Integrations** and choose **+ New Access Token**.
3. Fill in **Purpose** (for example `EduAI`). Leave the expiration fields blank for a token that does not expire, or set a date past the end of your pilot. Choose **Generate Token**.
4. The **Access Token Details** dialog shows the token once. **Copy it now** — once you leave that page Canvas will not show it again, and you would have to regenerate it.

The token needs permission to read the courses you teach.

### Connect it in EduAI

Open the **profile menu** at the bottom of the Core sidebar, choose **Settings**, then the **Canvas** tab. Settings has four tabs: Account, Accessibility, Providers, and Canvas.

Fill in the **Canvas Integration** card:

1. **Canvas instance URL** — the site root only, for example `https://canvas.ubc.ca`. No trailing slash, and no `/api/v1`.
2. **Personal access token** — paste the token you just copied.
3. Choose **Connect Canvas** and wait for a success state.

Your token is encrypted on the EduAI server and is never returned to the browser after saving.

### Fetch courses into EduAI

Go back to **Dashboard** and scroll to the **Canvas courses** card at the bottom. It names the Canvas instance you are connected to. Choose **Fetch from Canvas**.

A dialog lists the Canvas courses you teach, each with a checkbox. Tick the ones you want and choose **Fetch selected**. Clicking a course that has already been fetched opens it instead.

Your fetched courses now appear under **Courses**, grouped by term, each card showing its code, title, term, and a **Published** or **Draft** badge. The page has a search box, Status and Term filters, and paging controls at the bottom — search covers your whole course list, not just the page you are looking at.

Open the course you will teach.

**If you're stuck:** No courses listed — confirm the Canvas token can see your teacher-role courses, and that your admin has left **Instructors can manage Canvas integration** enabled. Connection errors — re-check the URL is a bare site root, and that the token has not expired.

---

## 4. Core course basics

A course page has these tabs: **Overview**, **Materials**, **Topics**, **Enrollments**, **Staff**, **Settings**, and **Chat history**.

**Overview** summarises the course: student, material, and embedded-chunk counts, then course information (code, term, status, published state) and the assigned instructor and TAs.

**Chat history** is greyed out unless an admin has turned on the instructor chat-viewing policy, which is **off by default**. A disabled tab here is expected, not a bug.

### Materials

On the **Materials** tab you can either upload files from your device, or pull them from the linked Canvas course.

Uploaded material is chunked and indexed before course-aware chat can use it. Watch the **Material status** panel on your dashboard: a file is only usable once it reaches **Ready**. A **Failed** file will not appear in AI answers.

### Enrollments

On the **Enrollments** tab, review who is enrolled and add students or TAs as your pilot process requires.

> For courses fetched from Canvas, students and TAs are enrolled automatically once they register and add their student ID.

### Publish the course

Publishing is on the **Courses** page, not inside the course. Open the **⋮** menu on the course card and choose **Publish course** — the same menu reads **Unpublish course** when the course is already live, alongside **Edit course** and **Delete course**. The card badge tracks the current state.

**If you're stuck:** No publish option — your admin may have turned off the instructor publish policy. Students cannot see the course — confirm it is Published **and** that they hold an active enrollment.

---

## 5. Switch to AI Tutor

### Open AI Tutor

Choose **Switch app** at the bottom of the sidebar and pick **AI Tutor**.

You do not import anything. The courses you teach in Core appear in AI Tutor automatically the first time you sign in, and each one keeps Core's published state.

### Publish a module or lesson

Open your course. The course page has **Content**, **Submissions**, **Feedback**, and **Analytics** tabs.

On **Content**, use **Add module** to create one. New modules start as **Draft** and are marked *Hidden from students*. Open the module's **⋮** menu and choose **Publish module**.

Lessons and activities publish the same way, and students only see them when the parent course and module are published too.

**If you're stuck:** AI Tutor asks you to sign in again — sign in on Core first, in the same browser, then use Switch app. A course is missing — see the sync timings in [Known limitations](#8-known-limitations).

---

## 6. Question Maker (one happy path)

### Open Question Maker

From **Switch app**, open **Question Maker**.

As in AI Tutor, the courses you teach appear on their own — there is no import step. Each course is also given a starter **Practice Exam** assessment automatically.

### Open the course workspace

Select your course. The workspace has **Overview**, **Questions**, **Assessments**, and **Canvas** tabs.

### Create a question, then generate an AI variant

Question Maker's AI assist rewrites an *existing* question rather than inventing a set from a topic, so create one question first.

1. On **Questions**, add a question with its text, type, difficulty, topics, and choices.
2. Generate an **AI variant** of that question.
3. Review and edit the draft — treat everything the model produced as a draft, not an answer key.
4. **Approve** the variant to push the finished question into Core.

### Confirm it appears in the bank

Open **Questions** for the course, or the cross-course **Question Library** in the sidebar, and find the new item.

**If you're stuck:** Generation fails — the campus model may be busy; retry or ask your coordinator. Approval fails — the linked Core course or topic changed; refresh the course data, fix the topic mapping, and retry.

---

## 7. If you're stuck (quick reference)

Onboarding-specific problems:

| Symptom | What to try |
|---------|-------------|
| Invite link dead | Ask your admin to resend the invitation |
| Signed in but no teaching tools | Confirm your platform role is Instructor, not Student |
| No courses after fetching from Canvas | Re-check the token's permissions, then retry the fetch |
| Course in Core but not yet in AI Tutor or Question Maker | Wait about a minute and reload — see [Known limitations](#8-known-limitations) |
| Publish option missing | Ask your admin about the instructor publish policy |
| Question Maker shows access denied | Question Maker is instructor-only; confirm your role |

The [user guide's troubleshooting table](USER_GUIDE.md#troubleshooting) covers the rest of the platform, for all roles.

---

## 8. Known limitations

Honest limits for the current pilot:

- **Cross-app sync is not instant.** Core is the source of truth. The course list each extension mirrors refreshes at most once a minute per user, and rosters refresh on about a 30-second cycle. If a change you made in Core is not visible yet, wait a minute and reload rather than signing out.
- **Canvas sync edge cases.** Sync is under active improvement. Roster or publish state from Canvas may occasionally disagree with Core, and files removed in Canvas can still appear in AI answers until materials are refreshed.
- **AI answers depend on processed materials.** Chat grounds its answers in material that finished indexing. If retrieval fails quietly, replies may lack course context — check the material status panel before assuming the model is at fault.
- **Large course catalogs.** The AI Tutor and Question Maker course pickers may not list every course if your catalog is very large. Core's own course search and pagination are server-side and do cover your whole list.
- **Same-browser sign-in.** The extensions rely on Core's session in the same browser. After a platform update, sign in again on Core and then use Switch app.
- **Admin policy flags.** Creating courses, connecting Canvas, managing enrollments, publishing, and viewing course chats are each governed by a policy an admin can switch off. Instructor chat viewing is off by default; the others are on by default. A missing button may be deliberate for this pilot — ask your coordinator before filing a bug.

---

## 9. Walkthrough checklist (team dry-run)

Internal QA only — not part of instructor onboarding. Have a teammate act as a **new instructor** and check each box, or file a follow-up issue:

- [ ] Accepted invite and signed in on Core
- [ ] Created a Canvas access token and connected it in Settings → Canvas
- [ ] Fetched at least one course from the dashboard's Canvas courses card
- [ ] Uploaded a material and saw it reach Ready
- [ ] Reviewed the Enrollments tab
- [ ] Published the course from the course card's ⋮ menu
- [ ] Opened AI Tutor via Switch app and confirmed the course was already there
- [ ] Added and published a module
- [ ] In Question Maker: confirmed the course was already there, created a question, generated and approved an AI variant
- [ ] Captured confusion points and any step whose wording no longer matches the UI

---

## Related documentation

Full platform reference for every role: [`USER_GUIDE.md`](./USER_GUIDE.md).
Extension auth wiring and service keys: [`EXTENSION_ONBOARDING.md`](./EXTENSION_ONBOARDING.md).
Deployment and hostnames: [`DEPLOYMENT.md`](./DEPLOYMENT.md).
Architecture overview: [`ARCHITECTURE.md`](./ARCHITECTURE.md).
