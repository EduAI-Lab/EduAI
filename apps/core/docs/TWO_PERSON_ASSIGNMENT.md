# EduAI Core — Two-Person UI Skeleton Assignment

**Scope:** `apps/core` · **Goal:** Presentational components (props, types, layout) — no new API wiring  
**Full audit:** See implementation plan Section 2.1

---

## Split strategy

Divide by **feature area + route files**, not “every other file.” Each person owns **components + the routes that feed them** for their area.

---

## Ownership overview

| | Person A — Platform & courses | Person B — Chat & admin |
| --- | --- | --- |
| **Domain components** | ~15 | ~14 |
| **Branch** | `skeleton/person-a-platform` | `skeleton/person-b-chat-admin` |
| **Est. (Claude-assisted, skeleton only)** | ~4–6 h | ~4–6 h |
| **Est. (Claude-assisted, skeleton + tests)** | ~8–12 h | ~8–12 h |

---

## Components

| Person A | Person B |
| --- | --- |
| `login-form` | `chat-welcome` |
| `register-form` | `chat-message` |
| `app-sidebar` | `chat-input` |
| `nav-main` | `chat-typing-indicator` |
| `nav-secondary` | `suggested-prompts` |
| `nav-documents` | `markdown-renderer` |
| `nav-user` | `system-prompt-settings` |
| `site-header` | `api-key-settings` |
| `site-navigation` | `users-table` |
| `site-footer` | `user-form-dialog` |
| `animated-background` | `providers-table` |
| `team-member-card` | `provider-form-dialog` |
| `project-goals` | `ai-models-table` |
| `course-materials-upload` | `model-form-dialog` |
| `course-selector` | |

---

## Routes

| Person A | Person B |
| --- | --- |
| `routes/auth/login.tsx` | `routes/chat.tsx` |
| `routes/auth/register.tsx` | `routes/admin.users.tsx` |
| `routes/team.tsx` | `routes/admin.ai-models.tsx` |
| `routes/courses.$courseId.tsx` | |
| `routes/dashboard.tsx` (only if sidebar props change) | |

---

## I/O refactors (move `fetch` / hooks to routes)

| Person A | Person B |
| --- | --- |
| `course-materials-upload` | `api-key-settings` (`useApiKeys` → `chat` route) |
| `course-selector` | `model-form-dialog` (`GET /api/ollama-models` → route) |

---

## Optional / shared (last)

| Item | Owner | Notes |
| --- | --- | --- |
| `section-cards`, `chart-area-interactive`, `data-table` | Whoever finishes first | Skip or ~1 h static props |
| Audit table Status column | One designated person | Set to **exists (skeleton)** per merged PR |

---

## Handoff checklist

| Step | Person A | Person B |
| --- | --- | --- |
| Audit rows | Plan Section 2.1 — A components only | Plan Section 2.1 — B components only |
| Rules | No `fetch` / hooks in `app/components/`; export `*Props`; empty states via props | Same |
| Before PR | `cd apps/core && npm run typecheck` | Same |
| If tests in scope | `npm run test` | Same |

---

## Schedule

| Day | Person A | Person B |
| --- | --- | --- |
| **1** | Auth + marketing props → nav/sidebar props | Chat components props-only → `api-key-settings` hook to `chat` route |
| **2** | `course-materials-upload` refactor + `courses.$courseId` route | Admin tables/dialogs props + admin routes + `model-form-dialog` Ollama to route |
| **3** (if tests) | Tests in `app/tests/unit/` for A components only | Tests for B components only |

---

## Merge and integration

| Topic | Guidance |
| --- | --- |
| **Merge order** | Either PR first; second rebases on `main` |
| **After both land** | One integration smoke: sidebar, `/chat`, `/admin/*`, `/courses/:id` |
| **Tests added later** | Same split; no shared test file edits |

---

## Coordination (15 min standup)

| Rule | Detail |
| --- | --- |
| **Props convention** | `ComponentNameProps`; callbacks `onX` |
| **File ownership** | A: sidebar/nav only. B: `chat.tsx` only. No cross-edit in the same PR |
| **Audit tracker** | One person updates Status as PRs land |
| **Post-merge grep** | No `fetch(`, `useApiKeys`, `useChat` in `app/components/` except `ui/` |

---

## Paste-ready assignment messages

| Person | Message |
| --- | --- |
| **A** | Own auth, marketing, sidebar/nav, and course materials — refactor `course-materials-upload` / `course-selector`; routes: auth, team, `courses.$courseId`. |
| **B** | Own all chat + admin UI — refactor `api-key-settings` and `model-form-dialog`; routes: `chat`, `admin.users`, `admin.ai-models`. |

---

## Effort summary (both people)

| Scope | Calendar (2 devs) | With Claude |
| --- | --- | --- |
| Skeleton only | ~2–3 days | ~1–1.5 days |
| Skeleton + tests | ~3–4 days | ~2 days |
