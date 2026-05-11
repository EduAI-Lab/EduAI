# AI Tutor — System Overview Document

**Project:** AI Tutor
**Author:** Stavan Shah
**Institution:** University of British Columbia (UBC)
**Project Type:** Honours Capstone Project
**Deployment:** aitutor.ok.ubc.ca (accessible via UBC VPN)
**Date:** April 2026

---

## Table of Contents

1. [Introduction & System Overview](#1-introduction--system-overview)
2. [User Roles & Permissions](#2-user-roles--permissions)
3. [Navigation & UI Breakdown](#3-navigation--ui-breakdown)
4. [Main Features](#4-main-features)
5. [System Workflows](#5-system-workflows)
6. [Future Work & Next Integrations](#6-future-work--next-integrations)
7. [Codebase Walkthrough](#7-codebase-walkthrough)

---

## 1. Introduction & System Overview

### What Is AI Tutor?

AI Tutor is a web-based tutoring platform that helps university students learn course material through interactive, AI-powered practice activities. Rather than passively reading notes or watching lectures, students work through questions designed by their instructors and receive real-time guidance from an AI tutor that adapts to their knowledge level — all without ever simply handing them the answer.

The platform is built as an **Honours Capstone Project** at the University of British Columbia by Stavan Shah. It is currently deployed on UBC servers at `aitutor.ok.ubc.ca` and is accessible through the UBC VPN.

### How Does It Fit Into the Bigger Picture?

AI Tutor is one of several **sister applications** within a larger ecosystem called **EDU AI**. EDU AI acts as a centralized parent platform — similar in concept to a Canvas or Blackboard system — that handles shared responsibilities like user authentication, course management, and AI model access. Sister applications such as AI Tutor, Question Maker, and Rubric Generator each serve a specialized purpose but share common infrastructure through EDU AI.

Think of it this way:

- **EDU AI** is the central hub. It knows who the users are, what courses they are enrolled in, and which AI models are available.
- **AI Tutor** is a specialized extension that pulls course and user information from EDU AI, then provides its own interactive tutoring experience on top of that shared foundation.

This design means that a student who logs into EDU AI can seamlessly access AI Tutor (and eventually other tools) without creating separate accounts or re-enrolling in courses.

### How the System Works (At a High Level)

AI Tutor is made up of two main parts that work together:

1. **The Frontend (What Users See):** A modern, responsive web application built with React. This is the interface where students answer questions, chat with the AI tutor, and track their progress — and where instructors build courses and configure activities.

2. **The Backend (What Runs Behind the Scenes):** A server application built with Express and backed by a PostgreSQL database. It handles user authentication, stores all course content and student submissions, manages AI tutoring sessions, and communicates with EDU AI for shared services like login and AI model access.

When a student interacts with the AI tutor, the request travels from the frontend to the backend, which then communicates with EDU AI's AI services. A key safety mechanism called the **dual-loop supervisor** reviews every AI response before it reaches the student, ensuring the tutor never leaks answers or provides guidance that is too easy. The validated response is then streamed back to the student in real time.

### Technology Summary

For readers with a technical background, the core technology stack includes:

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, React Router v7, TypeScript, Tailwind CSS v4 |
| Backend | Express 5, Node.js (via Bun runtime) |
| Database | PostgreSQL with Prisma ORM |
| Authentication | Better Auth (session cookies), EDU AI OAuth |
| AI Integration | EDU AI Chat API (supports Google Gemini, OpenAI, and others) |
| UI Components | Radix UI, Lucide Icons, driver.js (product tours) |
| Deployment | UBC servers (Apache httpd + PM2 + Docker PostgreSQL) |

---

## 2. User Roles & Permissions

AI Tutor supports three active user roles, each with distinct capabilities and access levels. A user's role is determined by their EDU AI account and is assigned when they first sign into AI Tutor.

### Students

Students are the primary users of AI Tutor. Their experience is focused entirely on learning.

**What Students Can Do:**

- **Browse enrolled courses** — Students see only the courses they are enrolled in, displayed as a visual dashboard of course cards with progress indicators.
- **Work through activities** — Navigate a course's modules and lessons, then complete interactive activities (multiple-choice or short-answer questions).
- **Receive instant feedback** — After submitting an answer, students immediately see whether they were correct or incorrect.
- **Use AI tutoring** — Access up to three AI-powered assistance modes (Teach, Guide, and Custom) to get help understanding concepts without having the answer given away.
- **Select a knowledge level** — Choose between Beginner, Intermediate, or Advanced to receive AI guidance tailored to their current understanding.
- **Track progress** — Visual progress bars show completion status at the course, module, and lesson levels.
- **Provide activity feedback** — Rate activities on a 1-to-5 scale and leave optional written feedback for instructors.
- **Submit bug reports** — Report issues with automatic capture of screenshots and technical context.
- **Take guided tours** — Access interactive walkthroughs that explain the interface and features step by step.

**What Students Cannot Do:**

- Create, edit, or delete any course content.
- Access other students' submissions or progress.
- Change system settings or manage users.
- Select AI models that the administrator has not approved.

---

### Instructors (Professors)

Instructors are the content creators. They build the course structures and configure how AI tutoring behaves for each activity.

**What Instructors Can Do:**

- **Create and manage courses** — Build courses from scratch or import them from EDU AI or from other existing courses within AI Tutor.
- **Build content hierarchies** — Organize courses into Modules, then Lessons, then individual Activities. Each level can be independently created, edited, and ordered.
- **Create activities** — Design multiple-choice or short-answer questions, write hints, and assign topics to each activity.
- **Configure AI tutoring modes** — For every activity, choose which AI modes are available to students (Teach, Guide, Custom) and write custom AI prompts when desired.
- **Manage topics** — Create course-level topics, sync topics from EDU AI, and assign main and secondary topics to activities for semantic organization.
- **Control publishing** — Use a hierarchical publish/unpublish system. A lesson can only be published if its parent module is published, and a module can only be published if its parent course is published. Unpublishing a course cascades down to all its modules and lessons.
- **Import content** — Pull in modules and lessons from other courses, or import entire course structures from EDU AI with a single action.
- **Submit bug reports** — Report issues from anywhere in the platform.

**What Instructors Cannot Do:**

- Manage user accounts or enrollments.
- Change system-wide AI model policies.
- Access the admin control panel.

---

### Administrators

Administrators manage the operational side of AI Tutor. They do not interact with course content directly.

**What Administrators Can Do:**

- **Manage user enrollments** — View all courses, see which students are enrolled, and manually add or remove students from courses.
- **Configure AI model policies** — Control which AI models students are allowed to use, set default tutor and supervisor models, enable or disable the dual-loop supervisor, and set iteration limits.
- **Manage the EDU AI API key** — View, set, or clear the API key that connects AI Tutor to EDU AI services.
- **Review bug reports** — Access a full dashboard of all submitted bug reports with technical details (console logs, network logs, screenshots, page URLs) and update their status.
- **View all users** — See a list of every registered user and their role.

**What Administrators Cannot Do:**

- Create, edit, or access course content, modules, lessons, or activities.
- Use the student or instructor interfaces.

---

### Teaching Assistants (TAs)

The TA role exists in the system's database schema but is **not currently supported** in the user interface. Users with a TA role who attempt to sign in are directed to an informational page explaining that TA support is not yet available. Supporting TAs with a tailored set of permissions is part of the future development roadmap.

---

### Role Summary Table

| Capability | Student | Instructor | Admin |
|-----------|---------|-----------|-------|
| View enrolled courses | Yes | Yes (own courses) | Yes (all courses) |
| Complete activities | Yes | No | No |
| Use AI tutoring chat | Yes | No | No |
| Create/edit course content | No | Yes | No |
| Publish/unpublish content | No | Yes | No |
| Import courses from EDU AI | No | Yes | No |
| Manage enrollments | No | No | Yes |
| Configure AI model policies | No | No | Yes |
| Review bug reports | No | No | Yes |
| Submit bug reports | Yes | Yes | No |

---

## 3. Navigation & UI Breakdown

AI Tutor uses a clean, card-based design with a warm, earthy color palette. The interface is fully responsive, adapting from a single-column layout on mobile devices to a multi-column grid on larger screens. Navigation follows a consistent top-to-bottom hierarchy: a persistent top navigation bar anchors every page, and breadcrumb trails let users retrace their steps at any point.

### The Navigation Bar (Always Visible)

A sticky navigation bar appears at the top of every page and contains:

- **AI Tutor logo and wordmark** — Clicking it returns the user to their dashboard.
- **Primary navigation link** — Changes based on role: "My Courses" for students, "Teaching" for instructors, or "Admin" for administrators.
- **EDU AI connection status** — A small indicator showing whether AI Tutor is successfully connected to EDU AI services (green for connected, red for disconnected).
- **Tour button** — Visible on student pages; starts an interactive guided tour of the current page.
- **Bug report button** — Available to students and instructors; opens the bug reporting dialog.
- **User profile badge** — Displays the user's name and role.
- **Sign out button** — Ends the session and returns to the login page.

### Page-by-Page Breakdown

#### Login Page (`/`)

The first page users see. It features a split-screen layout:

- **Left side:** A decorative panel with animated floating nodes showing keywords like "Curriculum," "AI Insights," "Progress," and "Dashboard," conveying the platform's purpose at a glance.
- **Right side:** A clean sign-in area with a hero heading ("Master any subject with AI guidance"), feature highlights, and a prominent **"Sign in with EduAI"** button.

After signing in, users are automatically redirected to the appropriate dashboard based on their role.

---

#### Student Pages

**Student Dashboard (`/student`)**

The student's home screen. Displays all enrolled courses as a grid of cards. Each card shows:

- Course title and description
- A progress bar indicating how much of the course has been completed
- Enrollment count

Clicking a course card navigates to that course's module listing.

**Course View (`/student/courses/:courseId`)**

Shows all modules within a selected course. Each module appears as a numbered card with its title, description, and a progress bar. A breadcrumb trail at the top reads: *My Courses > [Course Title]*.

**Module View (`/student/module/:moduleId`)**

Lists all lessons within a module as numbered cards, each with a progress indicator. Breadcrumb: *My Courses > [Course] > [Module]*.

**Lesson Player (`/student/lesson/:lessonId`)**

This is the core learning interface and the most feature-rich page in the application. It is split into two sections:

- **Left panel (Main Content Area):**
  - A **lesson progress card** showing "Question X of Y" with a visual progress bar.
  - The **question card** displaying the current activity's question text, along with tags for its main topic and any secondary topics.
  - The **answer card** — either a set of radio buttons for multiple-choice questions or a text input field for short-answer questions.
  - A **Submit** button, a **Guide Me** button (to request AI help), and **Previous/Next** navigation arrows.
  - After submission, a **feedback banner** appears showing "Correct!" or "Not quite. Keep going!" with a visual icon.
  - An optional **activity feedback card** where students can rate the activity (1–5 stars) and leave a note.

- **Right panel (AI Chat Sidebar):**
  - A tabbed conversation interface with separate tabs for **Teach Mode**, **Guide Mode**, and **Custom Mode** (if enabled by the instructor).
  - An **AI model selector** dropdown showing available models.
  - A **message history** area displaying the ongoing conversation.
  - A **text input area** with suggested prompts for quick access.
  - A **knowledge level selector** (Beginner / Intermediate / Advanced).

The breadcrumb trail provides full context: *My Courses > [Course] > [Module] > [Lesson]*.

---

#### Instructor Pages

**Instructor Dashboard (`/instructor`)**

Displays all courses the instructor teaches as a grid of cards. Each card includes a **publish/unpublish toggle** button. An **"Import from EduAI"** panel can be expanded to browse available EDU AI courses and import them with one click.

**Course Builder (`/instructor/courses/:courseId`)**

Shows all modules within a course. Instructors can:

- Create new modules using an inline text input.
- Toggle each module's publish status.
- Open an import panel to copy modules from other courses.
- Click a module card to drill into its lessons.

**Module Editor (`/instructor/module/:moduleId`)**

Lists all lessons within a module. Instructors can create new lessons, toggle publish status, import lessons from other modules, and click through to the lesson builder.

**Lesson Builder (`/instructor/lesson/:lessonId`)**

The instructor's primary content creation tool. Displays all activities in the lesson as a vertical stack of detail cards. For each activity, the instructor can:

- View and edit the question text, type, options, correct answer, and hints.
- Assign a **main topic** and toggle **secondary topics** from a checkbox grid.
- Toggle **AI mode availability** (Teach Mode on/off, Guide Mode on/off, Custom Mode on/off).
- Write and save a **custom AI prompt** (with a title and prompt body) for the Custom Mode.
- Delete activities with a confirmation step.

A side panel shows the course's topic list with sync status indicators for EDU AI integration.

---

#### Admin Page (`/admin`)

A single-page control panel organized into four tabs:

1. **Users Tab** — A table listing all registered users with their names, emails, and roles.
2. **Enrollments Tab** — A dropdown to select a course, then a split view showing enrolled students and available students, with add/remove buttons.
3. **Settings Tab** — Configuration for the EDU AI API key (status, set, clear) and the AI model policy (allowed models, default models, dual-loop supervisor toggle, iteration limits).
4. **Bug Reports Tab** — A searchable, filterable list of all submitted bug reports with expandable technical details and status management.

---

### Navigation Flow Summary

```
Login Page (/)
    |
    |-- [Sign in with EduAI]
    |
    |-- Student Role:
    |       /student (Dashboard)
    |           -> /student/courses/:id (Modules)
    |               -> /student/module/:id (Lessons)
    |                   -> /student/lesson/:id (Lesson Player + AI Chat)
    |
    |-- Instructor Role:
    |       /instructor (Dashboard)
    |           -> /instructor/courses/:id (Course Builder)
    |               -> /instructor/module/:id (Module Editor)
    |                   -> /instructor/lesson/:id (Lesson & Activity Builder)
    |
    |-- Admin Role:
            /admin (Control Panel: Users | Enrollments | Settings | Bug Reports)
```

---

## 4. Main Features

### 4.1 AI-Powered Tutoring Chat (Flagship Feature)

The AI tutoring chat is the centerpiece of AI Tutor. It provides students with real-time, conversational assistance while they work through activities — without ever giving away the answer.

**Three Tutoring Modes:**

- **Teach Mode:** The AI acts as an explainer. Students can ask questions like "Explain this concept in simpler terms" or "Why is this important?" and receive clear, pedagogical explanations related to the activity's topic. The AI provides context and background knowledge to help the student build understanding.

- **Guide Mode:** The AI acts as a Socratic guide. Rather than explaining outright, it provides hints, asks leading questions, and nudges the student toward the answer. Students can say things like "I'm stuck, give me a hint" or "What concept should I review?" This mode requires students to select their knowledge level (Beginner, Intermediate, or Advanced) so the AI can calibrate the difficulty of its hints.

- **Custom Mode:** When enabled by the instructor, this mode uses a custom AI prompt that the instructor has written specifically for that activity. This allows instructors to create tailored AI interactions — for example, a debugging-focused prompt for a programming activity or a proof-strategy prompt for a mathematics activity.

**Conversational Features:**

- Full multi-turn conversation history — students can have extended back-and-forth exchanges with the AI.
- Each mode maintains its own separate conversation, so switching between Teach and Guide does not lose context.
- Responses are streamed in real time, so students see the AI's reply as it is being generated.
- Suggested prompts provide quick-start options for students who are unsure what to ask.
- Students can select from available AI models (as approved by the administrator).

---

### 4.2 Dual-Loop Supervisor System

Behind every AI response is a safety mechanism called the **dual-loop supervisor**. This is the backend's most important quality control feature.

**How It Works:**

1. When a student sends a message, the **tutor model** generates an initial response.
2. Before that response reaches the student, a separate **supervisor model** reviews it against a set of pedagogical rules.
3. The supervisor checks for violations such as: directly revealing the answer, providing hints that are too obvious, or straying off-topic.
4. If the supervisor detects a violation, it either requests a revised response from the tutor or generates a safe fallback response itself.
5. This review cycle can repeat for a configurable number of iterations (default: up to 3) to refine the response.
6. Only the final, approved response is sent to the student.

**Why It Matters:**

The dual-loop system addresses one of the core risks of using AI in education: **answer leakage**. Without it, a student could simply ask the AI "What is the answer?" and receive it. The supervisor ensures that every response upholds the pedagogical intent — the AI helps students *learn*, not just *pass*.

Administrators can configure the supervisor settings, including which model acts as the supervisor, whether the dual-loop is enabled or disabled, and how many review iterations are allowed.

---

### 4.3 Course Content Management

Instructors build course content through a four-level hierarchy:

```
Course
  └── Module
        └── Lesson
              └── Activity
```

- **Courses** represent a full academic offering (e.g., "Intro to Algorithms").
- **Modules** are thematic units within a course (e.g., "Sorting Algorithms").
- **Lessons** are individual learning sessions within a module (e.g., "Bubble Sort").
- **Activities** are the interactive questions within a lesson — either multiple-choice or short-answer.

**Content Creation Tools:**

- Inline creation forms for modules, lessons, and activities.
- A rich activity editor for configuring questions, answer options, hints, topics, and AI modes.
- Support for Markdown in lesson content and activity instructions.

**Content Import System:**

- **Import from EDU AI:** Instructors can browse courses available in the EDU AI platform and import entire course structures (with modules, lessons, and metadata) into AI Tutor with a single click.
- **Import from other AI Tutor courses:** Instructors can copy modules or lessons from one course to another, enabling content reuse across offerings.

---

### 4.4 Hierarchical Publish System

AI Tutor uses a **cascading publish/unpublish model** to give instructors precise control over what students can see:

- A **module** can only be published if its parent **course** is published.
- A **lesson** can only be published if its parent **module** *and* grandparent **course** are both published.
- **Unpublishing a course** automatically unpublishes all of its modules and lessons in a single cascade.
- Students only see published content. Unpublished content is invisible to them.

This system allows instructors to prepare content in advance and release it on their own schedule, one module or lesson at a time.

---

### 4.5 Topic Management & EDU AI Sync

Every activity in AI Tutor is tagged with a **main topic** and optionally one or more **secondary topics**. Topics serve two purposes:

1. **Semantic organization** — They help group activities by subject area, making it easier for instructors to manage content and for the AI to provide contextually relevant guidance.
2. **EDU AI alignment** — Topics can be synced from EDU AI so that AI Tutor's content taxonomy matches the centralized platform.

Instructors can:

- Create topics manually for a course.
- Sync topics from EDU AI (for imported courses).
- Remap activities from one topic to another when topic structures change.

---

### 4.6 Student Progress Tracking

AI Tutor tracks student progress at every level of the content hierarchy:

- **Course-level progress** — What percentage of all activities across all modules and lessons have been completed.
- **Module-level progress** — Completion across all lessons in the module.
- **Lesson-level progress** — A "Question X of Y" indicator with a visual progress bar.
- **Activity-level completion** — Whether the student has submitted a correct answer.

Progress is displayed through visual progress bars on course, module, and lesson cards, giving students a clear sense of how far they have come and what remains.

---

### 4.7 Activity Feedback System

After completing an activity, students are invited to provide feedback:

- A **1-to-5 star rating** reflecting how useful or well-designed they found the activity.
- An optional **written note** for more detailed comments.

This feedback is stored per student per activity and contributes to aggregated analytics (such as average rating and difficulty scoring) that can inform future content improvements.

---

### 4.8 Interactive Guided Tours

AI Tutor includes a built-in **guided tour system** for student onboarding. When a student visits a page for the first time (or clicks the Tour button in the navigation bar), an interactive walkthrough highlights key interface elements one by one, with explanatory text at each step.

Tours are available for:

- The student dashboard (understanding course cards and navigation).
- The lesson player (understanding the question area, answer submission, AI chat, and progress tracking).

The tour system uses visual element highlighting and step-by-step navigation (Previous / Next), with progress indicators showing how many steps remain. Tour completion is remembered locally, so students are not shown the same tour repeatedly.

---

### 4.9 Bug Reporting System

Students and instructors can report bugs from anywhere in the platform using a dedicated bug report dialog. The system automatically captures:

- A **screenshot** of the current page (using HTML-to-canvas rendering).
- **Console logs** (browser error messages).
- **Network logs** (failed API requests).
- The **page URL** and **browser information**.
- The current **context** (which course, module, lesson, or activity the user was viewing).

Users write a description of the issue and can choose to submit anonymously. Administrators review all reports in a dedicated dashboard tab, where they can view the full technical details and update the status of each report.

---

### 4.10 AI Model Policy Administration

Administrators control which AI models are available to students and how the AI tutoring system behaves:

- **Allowed tutor models** — Select which models students can choose from (e.g., restrict to lower-cost models to manage expenses).
- **Default tutor model** — Set the model that is pre-selected for students.
- **Supervisor model** — Choose which model performs the dual-loop review.
- **Dual-loop toggle** — Enable or disable the supervisor system entirely.
- **Iteration limits** — Set the maximum number of supervisor review cycles (1–5).

These controls allow administrators to balance cost, performance, and safety based on institutional needs.

---

## 5. System Workflows

This section describes the primary user journeys through AI Tutor, step by step.

### 5.1 Signing In

1. The user navigates to `aitutor.ok.ubc.ca` (via UBC VPN).
2. The login page is displayed with the "Sign in with EduAI" button.
3. The user clicks the button, which initiates an authentication flow with the EDU AI platform.
4. EDU AI verifies the user's credentials and returns their identity and role to AI Tutor.
5. AI Tutor creates a session cookie and redirects the user to the appropriate dashboard:
   - Students are sent to `/student`.
   - Instructors are sent to `/instructor`.
   - Administrators are sent to `/admin`.
   - TAs are sent to an informational page explaining that TA support is not yet available.
6. The session persists across page refreshes until the user explicitly signs out.

---

### 5.2 Student: Completing an Activity

1. The student signs in and arrives at the **Student Dashboard**, which shows their enrolled courses.
2. The student clicks on a course card (e.g., "Intro to Algorithms").
3. The **Course View** displays the available modules (e.g., "Sorting," "Graph Basics"). The student clicks a module.
4. The **Module View** lists the lessons in that module. The student clicks a lesson to begin.
5. The **Lesson Player** loads, displaying the first activity:
   - The student reads the question.
   - For a multiple-choice question, the student selects an option. For a short-answer question, the student types their response.
6. The student clicks **Submit**.
7. The system evaluates the answer and immediately displays feedback:
   - **"Correct!"** with a success icon, or
   - **"Not quite. Keep going!"** with an encouragement icon.
8. An optional **feedback card** appears, inviting the student to rate the activity (1–5 stars).
9. The student clicks **Next** to move to the next activity, or uses **Previous** to revisit an earlier one.
10. The progress bar at the top updates with each completed activity.

---

### 5.3 Student: Using the AI Tutor

1. While on the Lesson Player, the student clicks **"Guide Me"** or selects a tab in the AI Chat sidebar (Teach, Guide, or Custom).
2. If entering **Guide Mode** for the first time on this activity, a dialog prompts the student to select their knowledge level (Beginner, Intermediate, or Advanced).
3. The student types a message (e.g., "I'm stuck — can you give me a hint?") or clicks one of the **suggested prompts** (e.g., "What concept should I review?").
4. The message is sent to the backend, which:
   - Retrieves the activity context (question, topic, hints, instructor prompt).
   - Sends the request to the AI tutor model via EDU AI.
   - Passes the tutor's response through the **dual-loop supervisor** for pedagogical validation.
   - Streams the approved response back to the student.
5. The student sees the AI's response appear in real time in the chat panel.
6. The student can continue the conversation with follow-up questions — the AI maintains full context from the ongoing exchange.
7. The student can switch between modes (Teach / Guide / Custom) at any time; each mode has its own independent conversation history.

---

### 5.4 Instructor: Building a Course

1. The instructor signs in and arrives at the **Instructor Dashboard**.
2. To create a new course, the instructor can either:
   - **Import from EDU AI:** Click "Import from EduAI," browse available courses, and click Import. The course structure (modules, lessons, metadata) is pulled in automatically.
   - **Build from scratch:** Use the course creation form.
3. The instructor clicks on the course card to enter the **Course Builder**.
4. The instructor creates modules using the inline "Add Module" form.
5. Within each module, the instructor creates lessons.
6. Within each lesson, the instructor creates **activities** using the Add Activity form:
   - Writes the question text.
   - Selects the type (Multiple Choice or Short Answer).
   - For multiple choice: enters at least four options and marks the correct one.
   - Writes one or more hints (one per line).
   - Assigns a main topic and optionally selects secondary topics.
   - Configures AI modes: toggles Teach, Guide, and Custom on or off.
   - For Custom Mode: writes a custom prompt title and prompt body.
7. The instructor publishes the content from the bottom up:
   - First publishes the **course**.
   - Then publishes individual **modules**.
   - Then publishes individual **lessons** within those modules.
8. Published content becomes visible to enrolled students.

---

### 5.5 Instructor: Importing and Reusing Content

1. From the **Instructor Dashboard**, the instructor can import an entire course from EDU AI by clicking "Import from EduAI," selecting a course, and confirming.
2. From the **Course Builder**, the instructor can import modules from other AI Tutor courses by opening the import panel, selecting a source course, and choosing which modules to copy.
3. From the **Module Editor**, the instructor can similarly import lessons from other modules.
4. After importing, the instructor can sync topics from EDU AI using the "Sync Now" button in the topic panel. If topic names have changed, the instructor uses the **topic remapping dialog** to reassign activities from old topics to new ones.

---

### 5.6 Administrator: Managing Enrollments

1. The administrator signs in and is directed to the **Admin Control Panel**.
2. The administrator clicks the **Enrollments** tab.
3. A dropdown lists all courses. The administrator selects a course.
4. The panel displays two lists: **Enrolled Students** and **Available Students** (registered users not yet enrolled).
5. To enroll a student, the administrator clicks the **Add** button next to their name.
6. To remove a student, the administrator clicks the **Remove** button next to their name.
7. Changes take effect immediately.

---

### 5.7 Administrator: Configuring AI Model Policy

1. From the Admin Control Panel, the administrator opens the **Settings** tab.
2. The **AI Model Policy** section displays:
   - A list of available AI models (fetched from EDU AI) with checkboxes to allow or disallow each one for student use.
   - Dropdowns for selecting the default tutor model and the supervisor model.
   - A toggle for enabling or disabling the dual-loop supervisor.
   - A numeric input for the maximum number of supervisor iterations.
3. The administrator adjusts the settings and saves.
4. Changes apply to all future AI tutoring interactions across the platform.

---

### 5.8 Submitting a Bug Report

1. From any page, the student or instructor clicks the **Bug Report** button in the navigation bar.
2. A dialog opens with a text area for describing the issue.
3. The system automatically captures a screenshot, console logs, network logs, and the current page context in the background.
4. The user writes a description (up to 2,000 characters) and optionally checks "Submit anonymously."
5. The user clicks **Submit**.
6. The report appears in the administrator's Bug Reports tab with all captured technical details.

---

## 6. Future Work & Next Integrations

AI Tutor is a functional, deployed platform, but it is still in its early stages. Several significant enhancements are planned to bring it closer to full integration with the EDU AI ecosystem and to expand its capabilities as a standalone tool.

### 6.1 Centralizing Data Into EDU AI (High Priority)

**Current State:** AI Tutor maintains its own local database of courses, modules, lessons, activities, topics, and question content. While courses and topics can be imported and synced from EDU AI, the activity content itself (questions, answers, hints, AI prompt configurations) lives entirely within AI Tutor's own PostgreSQL database.

**The Problem:** This means that the knowledge created inside AI Tutor — the question banks, the activity configurations, the topic taxonomies — is siloed. Other sister applications in the EDU AI ecosystem (such as **Question Maker** and **Rubric Generator**) cannot access or reuse this content.

**The Vision:** The future architecture would centralize shared data into a **common EDU AI database** that all sister applications can read from and write to. Specifically:

- **Question banks** would be stored in EDU AI, not locally. AI Tutor would query EDU AI for available questions and contribute new questions back to the shared pool.
- **Topic taxonomies** would be fully managed by EDU AI, with AI Tutor (and all other extensions) inheriting them rather than maintaining separate local copies.
- **Activity configurations** (AI mode settings, custom prompts, hints) could be standardized so that the same activity could be used across multiple tools.

This centralization would transform the ecosystem from a set of independent applications with import/export bridges into a truly integrated suite where content flows freely between tools.

---

### 6.2 Automated Course Enrollment via EDU AI (High Priority)

**Current State:** Student enrollment in AI Tutor courses is primarily a manual process. An administrator must go into the Admin Control Panel and individually add students to courses. While an enrollment sync mechanism from EDU AI exists, the flow is not yet fully automated or seamless.

**The Vision:** When a student enrolls in a course on EDU AI, that enrollment should automatically propagate to AI Tutor (and any other relevant sister application). The student would sign into AI Tutor and immediately see the courses they are enrolled in — no manual intervention required. This would:

- Eliminate the administrative burden of manually enrolling students in each sister application.
- Ensure consistency between EDU AI and AI Tutor enrollment records.
- Support large-scale deployments where manual enrollment is not feasible.

---

### 6.3 Teaching Assistant (TA) Role Support

**Current State:** The TA role exists in the database schema but is not supported in the user interface. Users with a TA role are shown an informational page and cannot access student or instructor features.

**The Vision:** TAs would have a tailored permission set — potentially a subset of instructor capabilities — allowing them to assist with course management, review student progress, or moderate content without having full instructor privileges.

---

### 6.4 Analytics Dashboard for Instructors

**Current State:** AI Tutor already collects extensive analytics data behind the scenes. The database tracks:

- Per-activity metrics: submission counts, correct/incorrect rates, help request counts, student engagement counts.
- Per-student metrics: individual submission history, AI interaction frequency.
- Aggregated analytics: average ratings, feedback counts, and computed difficulty scores (Low / Medium / High) for each activity.

However, **there is no dedicated analytics interface** for instructors. This data is collected but not yet surfaced.

**The Vision:** A future analytics dashboard would give instructors actionable insights, such as:

- Which activities have the highest failure rates and may need clearer questions or better hints.
- Which topics generate the most AI help requests, indicating areas where students are struggling.
- How student engagement varies across modules and lessons.
- Feedback trends over time.

---

### 6.5 Expanded Activity Types

**Current State:** AI Tutor supports two activity types: multiple-choice questions and short-answer (text) questions.

**The Vision:** Future development could introduce additional activity types to support richer learning experiences, such as:

- Code-writing exercises with automated evaluation.
- Drag-and-drop ordering or matching activities.
- Long-form essay responses with AI-assisted rubric evaluation.
- Multi-part questions with sequential steps.

---

### 6.6 Broader Accessibility and Deployment

**Current State:** AI Tutor is deployed on UBC servers and is accessible only through the UBC VPN.

**The Vision:** As the platform matures, it could be made accessible outside the VPN for broader use — potentially serving multiple institutions or being offered as a standalone service within the EDU AI ecosystem. The existing `deploy.sh` script and Docker-based database setup provide a foundation for reproducible deployments.

---

### Summary of Future Priorities

| Priority | Item | Status |
|----------|------|--------|
| High | Centralize question banks and topics into EDU AI | Planned |
| High | Automate course enrollment through EDU AI | Partially implemented (sync exists) |
| Medium | TA role support | Schema ready, UI not implemented |
| Medium | Instructor analytics dashboard | Data collection in place, UI not built |
| Lower | Expanded activity types | Not started |
| Lower | Broader deployment beyond UBC VPN | Infrastructure ready |

---

---

## 7. Codebase Walkthrough

This section is the technical companion to the product overview above. It is written for new
developers who need to understand where the major pieces live and how a request moves through the
system.

### Repository Map

```text
app/                 React Router v7 SPA
server/              Express 5 API, Prisma, Better Auth, EduAI integrations
shared/schemas/      Zod schemas shared by frontend and backend
docs/                Architecture, API, deployment, and system notes
public/              Static assets
scripts/             E2E and automation scripts
```

The application has two independently running halves:

- **Frontend:** `app/`, served by Vite in development and static assets in production.
- **Backend:** `server/`, an Express API on port `4000` backed by PostgreSQL.

The frontend calls the backend with cookie credentials. The backend handles authentication,
authorization, persistence, and EduAI API calls.

### Frontend Tour (`app/`)

Important files and directories:

| Path | Purpose |
|------|---------|
| `app/root.tsx` | HTML shell and provider stack: auth, bug reports, guided tours |
| `app/routes.ts` | Flat React Router route map |
| `app/routes/` | Page-level route modules for home, student, instructor, and admin flows |
| `app/components/` | Shared UI, activity cards, AI chat, guided tours, bug reports |
| `app/hooks/useLocalUser.tsx` | Better Auth session state exposed through React context |
| `app/lib/api.ts` | Central API client; all requests use `credentials: 'include'` |
| `app/lib/client-auth.ts` | `requireClientUser(role)` route guard helper |
| `app/lib/tours/` | Guided tour definitions, engine, storage, and tests |
| `app/app.css` | Tailwind v4 theme and custom utility classes |

Routes are flat rather than nested. The main paths are:

| Path | Module | Role |
|------|--------|------|
| `/` | `home.tsx` | Public login |
| `/student` | `student.tsx` | Student dashboard |
| `/student/courses/:courseId` | `student.course.tsx` | Course view |
| `/student/module/:moduleId` | `student.topic.tsx` | Module view |
| `/student/lesson/:lessonId` | `student.list.tsx` | Lesson player |
| `/instructor` | `instructor.tsx` | Instructor dashboard |
| `/instructor/courses/:courseId` | `instructor.course.tsx` | Course editor |
| `/instructor/module/:moduleId` | `instructor.topic.tsx` | Module editor |
| `/instructor/lesson/:lessonId` | `instructor.list.tsx` | Lesson builder |
| `/admin` | `admin.tsx` | Admin panel |

Frontend state is intentionally simple: React context plus hooks. There is no Redux or Zustand.
The most important contexts are auth/session, course topics, bug report capture, and guided tours.

### Backend Tour (`server/`)

Important files and directories:

| Path | Purpose |
|------|---------|
| `server/src/index.js` | Loads env, creates the app, and listens on `PORT` |
| `server/src/app.js` | Express app factory, middleware order, route mounting |
| `server/src/auth.js` | Better Auth configuration with EduAI OAuth |
| `server/src/middleware/auth.js` | Session hydration and role guards |
| `server/src/routes/` | HTTP route handlers |
| `server/src/services/` | Business logic for AI, analytics, cloning, sync, settings, bugs |
| `server/src/utils/mappers.js` | Response shape mappers mirrored by frontend types |
| `server/prisma/schema.prisma` | Database schema |
| `server/prisma/seed.ts` | Destructive demo-data seed script |
| `server/test/` | Vitest unit and integration tests |

Backend request handling follows this shape:

1. CORS allows the SPA to send cookies.
2. Better Auth handles `/api/auth/*`.
3. JSON parsing runs for application routes.
4. `attachSession` resolves the Better Auth cookie and hydrates `req.user` from Prisma.
5. API routes require `requireAuth`, `requireRole`, or `requireRoles`.
6. Admin users are isolated to admin-safe endpoints.
7. Route handlers orchestrate calls into services.
8. Response mappers shape Prisma rows for the frontend.

The route layer should stay thin. Business rules belong in `server/src/services/`, and request
validation should use Zod schemas from `shared/schemas/` when a shared schema exists.

### Database Model

The core content hierarchy is:

```text
CourseOffering -> Module -> Lesson -> Activity
```

Related records track enrollments, instructors, submissions, activity feedback, topics, AI chat
sessions, AI interaction traces, analytics, system settings, and Better Auth sessions/accounts.

When schema changes are made, create a migration and refresh generated Prisma artifacts:

```bash
cd server
bunx prisma migrate dev --name description_of_change
bun run seed
```

The seed is destructive and clears existing rows before inserting demo data.

### Authentication Path

Authentication is EduAI OAuth through Better Auth:

1. The user clicks **Sign in with EduAI** on the home page.
2. Better Auth redirects to EduAI using OIDC + PKCE.
3. EduAI redirects back and Better Auth stores a session cookie.
4. The SPA calls `GET /api/me` through `AuthProvider`.
5. Route loaders use `requireClientUser(role)` for frontend gating.
6. Backend routes use `requireAuth`, `requireRole`, or `requireRoles` for enforcement.

There is no JWT bearer-token flow in the current app. Client API calls must preserve
`credentials: 'include'`.

### AI Tutoring Path

The AI tutoring engine lives primarily in `server/src/services/aiGuidance.js`.

Student chat requests go through activity endpoints such as:

- `POST /api/activities/:activityId/teach`
- `POST /api/activities/:activityId/guide`
- `POST /api/activities/:activityId/custom`

Each mode builds context from the activity, topic, answer key, selected knowledge level, model
policy, and optional user API key. The tutor response can then be reviewed by the dual-loop
supervisor before it reaches the student. See
[`two-agent-supervisor-system.md`](two-agent-supervisor-system.md) for the focused design notes.

### Local Development

Install dependencies:

```bash
bun install
cd server && bun install
```

Start PostgreSQL:

```bash
docker compose up -d db
```

Apply migrations and seed demo data:

```bash
cd server
bunx prisma migrate deploy
bun run seed
```

Run the app in two terminals:

```bash
# Terminal 1: backend API
cd server && bun run dev

# Terminal 2: frontend SPA
bun run dev
```

Useful verification commands:

```bash
bun run typecheck
bun run typecheck:fast
bun run lint
bun run format:check
bun run test
cd server && bun run test
```

### Recommended Reading Order

1. `README.md` for setup and the shortest project summary.
2. This document for product context, roles, workflows, and the codebase map.
3. `docs/ARCHITECTURE.md` for runtime architecture and core contracts.
4. `app/README.md` for frontend details.
5. `server/README.md` for backend details.
6. `docs/api-reference.md` for endpoint shapes.
7. `docs/DEPLOYMENT.md` for production layout.

---

*This document describes the AI Tutor system as of April 2026. The platform is under active development, and features described in the Future Work section are subject to change as the EDU AI ecosystem evolves.*
