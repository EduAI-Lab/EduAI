# EduAI instructor onboarding

**Who this is for:** Instructors joining the EduAI pilot.  
**What you will do:** Create your account, connect Canvas, set up a course in Core, then try AI Tutor and Question Maker.

| App | URL |
|-----|-----|
| EduAI (Core) | https://my.eduai.ok.ubc.ca |
| AI Tutor | https://ai-tutor.eduai.ok.ubc.ca |
| Question Maker | https://qm.eduai.ok.ubc.ca |

If login fails, confirm the Core host with your pilot coordinator (some internal docs also mention `eduai.ok.ubc.ca`).

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

Go to https://my.eduai.ok.ubc.ca and sign in (campus login / EduAI sign-in as shown on the page).

![Core sign-in page](./images/instructor-onboarding/sign-in.png)


### Land on your dashboard

After sign-in you should see the Core home / courses area.

![Core dashboard page](./images/instructor-onboarding/dashboard.png)


**If you’re stuck:** The invite link expired — ask your admin to resend. Wrong role (e.g. Student) — ask them to invite you as **Instructor**.

---

## 3. Connect Canvas and sync courses

Canvas is how many pilot courses enter EduAI.

### Open Canvas settings

In Core, open **Settings**. Find the **Canvas** section.

![Connect canvas page](./images/instructor-onboarding/canvas-connect.png)


### Connect

1. Enter your institution canvas URL (for example http://canvas.ubc.ca).  
2. Paste a Canvas personal access token with permission to read your courses.  
3. Save / Connect. Wait for a success state (not an error).

#### To get your canvas token:

![Connect canvas - step 1](./images/instructor-onboarding/canvas-step-1.png)
![Connect canvas - step 2](./images/instructor-onboarding/canvas-step-2.png)
![Connect canvas - step 3](./images/instructor-onboarding/canvas-step-3.png)
![Connect canvas - step 4](./images/instructor-onboarding/canvas-step-4.png)



### Sync courses into EduAI

Return to **Courses**. Use **Sync from Canvas** (or equivalent) and choose the course(s) to bring into EduAI.


![Sync course](./images/instructor-onboarding/sync-course.png)
![Sync course - 1](./images/instructor-onboarding/sync-course-1.png)

After synching, you should be able to see the course on your Courses page.

![Courses](./images/instructor-onboarding/courses.png)


Open the course you will teach.

**If you’re stuck:** No courses after sync — confirm the Canvas token can see teacher courses, and that the Canvas policy for instructors is enabled on this deployment. Connection errors — check URL (no trailing path junk) and whether it was expired token.

---

## 4. Core course basics

On the course page you will use tabs (or sections) for materials, enrollments, and publish.

![Course detail](./images/instructor-onboarding/course-detail.png)


### Materials

You can either manually upload materials from your device

![Course material - upload](./images/instructor-onboarding/course-material-upload.png)

or sync materials from the canvas course

![Course material - sync](./images/instructor-onboarding/course-material-canvas.png)

![Course material](./images/instructor-onboarding/course-material.png)



### Enrollments

Review who is enrolled. Add students or TAs as your pilot process requires.

![Course enrollment - student](./images/instructor-onboarding/course-enrollment-student.png)

![Course enrollment - TA](./images/instructor-onboarding/course-enrollment-TA.png)


> For courses synched from canvas, once your student or TA registers and adds their student id, they will be automatically enrolled into the course.


### Publish the course

When the course should be visible to students, use **Publish** (unpublished courses stay instructor-only for students).

![Course publishing](./images/instructor-onboarding/course-publishing.png)


**If you’re stuck:** Cannot publish — a platform policy may disable instructor publish; ask your admin. Students cannot see the course — confirm publish **and** that they have are enrolled in the course.

---

## 5. Switch to AI Tutor

### Open AI Tutor

From Core, use the **app switcher** (brand / apps control in the header) and choose **AI Tutor**.

![App switching](./images/instructor-onboarding/switch-app.png)

You should land on an instructor-friendly home (dashboard or course list).

![Dashboard](./images/instructor-onboarding/aitutor-dashboard.png)


### Publish a module or lesson

Open your course → a module → (optionally) a lesson. Use the **Publish** control so students can see that content when the parent course/module rules allow.

![Course](./images/instructor-onboarding/aitutor-courses.png)

![Module](./images/instructor-onboarding/aitutor-module-publish.png)

![Lesson](./images/instructor-onboarding/aitutor-module-lesson.png)


**If you’re stuck:** AI Tutor asks you to sign in again — return to Core, sign in, then use the app switcher (you stay signed in across apps in the same browser). Course missing — import/link from Core or wait for sync; ask support if it never appears.

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
| AI Tutor or Question Maker sends you to login | Sign in on Core first, same browser, then app switcher |
| Students cannot see content | Course published + content published + active enrollment |

---

## 8. Known limitations

These are honest limits for the current pilot:

- **Course search after Canvas sync:** If a newly synced course does not show up in Core search, clear the search box and check later pages. Search currently scans only the page you are on, not your full course list.
- **Canvas sync edge cases:** Sync is under active improvement. In rare cases, roster or publish state from Canvas may not match what you see in Core, or removed Canvas files may still appear in AI answers until materials are refreshed.
- **AI Tutor enrollments can lag Core:** The enrollments panel in AI Tutor may not match Core immediately. Refresh the page or sign in again on Core if roster changes do not appear.
- **Large course catalogs:** AI Tutor and Question Maker course pickers may not list every course if you have a very large catalog. Search across all your courses is coming later.
- **AI answers and materials:** Chat relies on uploaded or synced materials. If retrieval fails quietly, replies may lack course context.
- **Cross-app sync lag:** Core is where course and roster changes are made first. AI Tutor and Question Maker may not show those changes until you refresh or sign in again on Core.
- **Same browser sign-in:** If AI Tutor or Question Maker sends you back to login after a platform update, sign in again on Core in the same browser, then use the app switcher.
- **Admin policy flags:** Some instructor actions (create course, connect Canvas, publish) can be turned off by admin policy. If a button is missing, it may be intentional for this pilot — ask your coordinator rather than assuming a bug.

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
