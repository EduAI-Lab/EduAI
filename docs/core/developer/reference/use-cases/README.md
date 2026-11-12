# Use-Case Scenarios

Technically-grounded scenarios describing how the EduAI platform is used, misused, and attacked — from every actor's perspective. Written for both humans and AI agents to use as a reference for expected and adversarial system behavior.

## Layout

```
docs/use-cases/
  core/          # apps/core actor scenarios
  qm/            # apps/extensions/question-maker actor scenarios
  ai-tutor/      # apps/extensions/ai-tutor actor scenarios
```

### Core actors (`core/`)

- [`admin.md`](admin.md) — platform ADMIN
- [`unit-admin.md`](unit-admin.md) — UNIT_ADMIN
- [`instructor.md`](instructor.md) — INSTRUCTOR (course-level `instructor` access)
- [`ta.md`](ta.md) — TA (course-level `ta` access; platform role is STUDENT with a TA enrollment)
- [`student.md`](student.md) — STUDENT
- [`unauthenticated.md`](unauthenticated.md) — no session: pre-login, expired/invalid session, anonymous probing
- [`service-caller.md`](service-caller.md) — AI Tutor/Question Maker calling Core via `EDUAI_API_KEY` + optional `proxyUser`

### AI Tutor actors (`ai-tutor/`)

- [`student.md`](../../../../ai-tutor/developer/reference/use-cases/student.md) — STUDENT (the dual-loop tutor/supervisor chat pipeline, answer submission)
- [`instructor.md`](../../../../ai-tutor/developer/reference/use-cases/instructor.md) — INSTRUCTOR (course/module/lesson/activity authoring, cloning, analytics)
- [`admin.md`](../../../../ai-tutor/developer/reference/use-cases/admin.md) — ADMIN (admin console, system settings, AI model policy, cross-course trace oversight)
- [`unit-admin.md`](../../../../ai-tutor/developer/reference/use-cases/unit-admin.md) — UNIT_ADMIN (department-scoped course authoring and trace oversight)
- [`ta.md`](../../../../ai-tutor/developer/reference/use-cases/ta.md) — TA (course-scoped grading/oversight; platform-role vs. enrollment-role TA distinction)
- [`unauthenticated.md`](../../../../ai-tutor/developer/reference/use-cases/unauthenticated.md) — no session: missing/expired cookie, Core-outage failure mode, internal-route separation
- [`service-caller.md`](../../../../ai-tutor/developer/reference/use-cases/service-caller.md) — Core↔AI Tutor server-to-server: cookie-forwarding vs. service-key call patterns, inbound cascade-delete

### Question Maker actors (`qm/`)

- [`instructor.md`](../../../../question-maker/developer/reference/use-cases/instructor.md) — INSTRUCTOR (questions, assessments, variants, OCR, and Canvas)
- [`admin.md`](../../../../question-maker/developer/reference/use-cases/admin.md) — ADMIN (platform-wide course access and bug-report triage)
- [`unit-admin.md`](../../../../question-maker/developer/reference/use-cases/unit-admin.md) — UNIT_ADMIN (department-scoped course authoring)
- [`ta.md`](../../../../question-maker/developer/reference/use-cases/ta.md) — TA (course-scoped access and current role-gate limitations)
- [`student.md`](../../../../question-maker/developer/reference/use-cases/student.md) — STUDENT (expected denial paths and documented authorization bugs)
- [`unauthenticated.md`](../../../../question-maker/developer/reference/use-cases/unauthenticated.md) — no session: provisioning, expiry, Core outages, and internal routes
- [`service-caller.md`](../../../../question-maker/developer/reference/use-cases/service-caller.md) — Core↔Question Maker service-key and cookie-forwarding call patterns

## Scenario categories

Every actor file groups scenarios under these headings:

- **Happy Path** — the system working exactly as intended
- **Typical Use** — normal but less-central usage
- **Error Recovery** — the actor or system recovers from a failure (network error, validation failure, Canvas API down, etc.)
- **Wrong/Malformed Usage** — accidental misuse (bad input, wrong order of operations) that isn't malicious
- **Malicious/Adversarial** — deliberate attempts to abuse the system (privilege escalation, data exfiltration, resource abuse)
- **Security** — including prompt-injection-style attacks against the chat/RAG pipeline (e.g. a chat message or uploaded material containing instructions like "ignore previous instructions" or `/inject`-style payloads)

## Scenario template

```markdown
### UC-<ROLE>-<NNN>: <short title>

- **Category:** Happy Path | Typical Use | Error Recovery | Wrong Usage | Malicious | Security
- **Actor:** concrete actor state, e.g. "INSTRUCTOR with `instructor` AccessLevel on courseId=42"
- **Preconditions:** session state, DB state, feature flags needed
- **Entry point(s):** route/loader/action file(s), e.g. `app/routes/api/chat.ts`
- **Flow:** step-by-step, written from the frontend/user's point of view, with the backend function(s) it triggers named in brackets:
  1. Student opens a course chat and sends a message (`app/routes/chat.$chatId.tsx` → `POST /api/chat`)
  2. Server checks the session is valid (`auth.api.getSession`)
  3. Server resolves the student's course access (`resolveCourseAccess`)
  4. ...
- **Expected outcome:** HTTP status, response shape, DB writes, side effects
- **Failure modes / what could go wrong:** the exploit/misuse attempt and what currently stops it — or flag as a gap if nothing does
- **Related code:** bullet list of file paths
```

## Adding a new scenario

1. Pick the next sequential ID for that role's file.
2. Trace the *real* code path — open the route/loader/action file and follow it. Don't guess.
3. Verify every file path and function name you cite actually exists.
4. If a security/misuse scenario reveals no real guard exists, say so in "Failure modes" — don't invent one.
