# EduAI Core — Activity Logging

**Last updated:** 2026-06-17

This document describes the in-product logging subsystem in **apps/core**: what is recorded, what personal data it touches, who can see it, and how long it is kept. It is written to support a **Privacy Impact Assessment (PIA)**.

---

## 1. Purpose

Core records a minimal, admin-facing trail of **security-relevant and administrative events** so that authorized administrators can answer *who did what, when*. Logging is for **accountability and security monitoring**, not analytics or user profiling.

There are three streams, all stored in Postgres:

| Stream | Table | What it captures | Retention default |
| --- | --- | --- | --- |
| **Audit** | `audit_logs` | Administrative mutations (who changed what) | **365 days** |
| **Security** | `audit_logs` (`category = SECURITY`) | Authentication, access-denials, rate-limiting | **365 days** |
| **System** | `system_logs` | Server-side errors (e.g. mail/embedding failures) | **90 days** |

Writes are **fire-and-forget**: a failed log write never blocks or fails the user request it describes.

---

## 2. What is logged

### Audit — administrative mutations (success path only)

| Event | What it records |
| --- | --- |
| User created | A new user account was provisioned. |
| User updated | A user's profile or attributes were modified. |
| User role changed | A user's role (e.g. STUDENT → INSTRUCTOR) was reassigned. |
| User deactivated | A user account was disabled without deletion. |
| User deleted | A user account was permanently removed. |
| Invitation created | A new invitation to join was issued. |
| Invitation resent | An existing invitation was sent again. |
| Invitation revoked | A pending invitation was cancelled. |
| Invitation accepted | A recipient accepted an invitation and joined. |
| Course created | A new course was added. |
| Course updated | A course's details were modified. |
| Course deleted | A course was removed. |
| Enrollment added | A user was enrolled in a course. |
| Enrollment role changed | An enrolled user's course role was changed. |
| Enrollment deactivated | A user's enrollment in a course was disabled. |
| Course TA assigned | A user was granted TA status on a course. |
| Course TA removed | A user's TA status on a course was revoked. |
| Material uploaded | A course material was uploaded for ingestion. |
| Material deleted | A course material was removed. |
| Topic created | A course topic was added. |
| Topic updated | A course topic was modified. |
| Topic deleted | A course topic was removed. |
| AI provider changed | An AI provider configuration was added, updated, or removed. |
| AI model changed | An AI model configuration was added, updated, or removed. |
| Embedding settings changed | The embedding configuration was modified. |
| Re-embed job created | A job to re-embed existing materials was queued. |
| Canvas integration saved | Canvas LMS integration settings were saved. |
| Bug report status changed | The status of a bug report was updated. |

### Security — auth & access

| Event | What it records |
| --- | --- |
| Login success | A user authenticated successfully. |
| Login failed | An authentication attempt was rejected. |
| Logout | A user ended their session. |
| Admin access denied | A non-admin was blocked from an admin-only resource. |
| Canvas access denied | A user was blocked from a Canvas-gated resource. |
| API key denied | A request with an invalid or unauthorized `x-api-key` was rejected. |
| Service key missing | A service-to-service request arrived without the required key. |
| Service key invalid | A service-to-service request presented an invalid key. |
| Rate limit exceeded | A client tripped a rate limit (abuse signal). |

### System — errors

| Event | What it records |
| --- | --- |
| Mail send failed | An outbound email (e.g. an invitation) failed to send. |
| Material embed failed | A course material failed during embedding. |

These are caught server-side failures, logged before re-throwing so behaviour is unchanged.

### Not logged (data minimization)
High-volume product activity is **deliberately excluded**: chat messages, AI generation (`/api/eduai`), RAG retrieval, and assistive-events. Ordinary reads/list views are not audited — only mutations and access-denials.

---

## 3. Personal data captured (PIA-relevant)

Each row may contain:

| Field | Personal data? | Notes |
| --- | --- | --- |
| `actorUserId`, `actorRole` | Yes (pseudonymous) | The acting user's ID and role. The **name** is shown in the UI via a live join to the user table, not stored on the log row. |
| `ipAddress` | Yes | Origin IP, when provided by an upstream proxy header. Often null in local/dev. |
| `userAgent` | Yes | Browser/client string. |
| `entityId` / `entityLabel` | Sometimes | The affected record (e.g. a user or course ID). For identity-related events `entityLabel` holds the subject's **email** (for user events, formatted as `name <email>` so users who share a display name stay distinguishable). |
| `details` (JSON) | Minimized | Free-form context, **sanitized before write** (see below). |

**Redaction.** Before any `details` object is written, keys whose name contains `password`, `token`, `cookie`, `phone`, `authorization`, `secret` (covers `sessionSecret`/`clientSecret`), `apiKey`, `accessKey`, `privateKey`, or `credential` are replaced with `[REDACTED]`. Redaction recurses through nested objects, arrays, `Map`s, and `Set`s; circular references are replaced with `[CIRCULAR]`. **Passwords, tokens, secrets, and API keys are never stored.** Identifier keys explicitly allowed for accountability: `studentId`, `ubcEmployeeId`.

**Email addresses are stored** for identity-relevant events — login success/failure, logout, user created/updated/deleted, and invitation created/resent/revoked/accepted — so an admin can answer *who* without a fragile join (and, on a failed login, the attempted email is the only available subject identifier). This is a deliberate product decision recorded in `logging.server.ts`; `email` is intentionally **not** in the redaction deny-list. Re-adding `email` to that list restores full email redaction if a future privacy decision requires it.

**Actor attribution.** If an actor's user record is later deleted, the log's `actorUserId` is nulled (`ON DELETE SET NULL`) but the `actorRole` captured at write time is retained, so the event remains attributable by role without retaining a foreign key to a deleted person.

---

## 4. Who can see the logs

- The viewer lives at **`/admin/logs`** and is restricted to users with the **`ADMIN`** role. Unauthenticated requests are redirected to login; authenticated non-admins are redirected to `/dashboard`. The gate is enforced in both the loader and the action.
- There is **no public or self-service access** — a user cannot view logs about themselves through this tool.
- Logs are stored in the same Postgres database as application data; direct database access is governed by existing infrastructure/DBA controls, not by this subsystem.

---

## 5. Retention

- **Defaults:** audit/security **365 days**, system **90 days**. Configurable per deployment in the `log_retention_policy` table (and via the retention panel on `/admin/logs`), bounded to **1–3650 days**.
- **Enforcement:** retention is swept by deleting rows older than the configured window. The sweep runs **when an admin opens `/admin/logs`**, self-throttled to **once per 24 hours**. Deletion is permanent.
- **Trade-off:** because the sweep is viewer-triggered, rows past their retention window persist until the next admin visit. For a guaranteed cadence independent of admin activity, run the same routine from a scheduled job (future enhancement; not in the current version).

---

## 6. Integrity & safety properties

- **Non-blocking:** every log write is fire-and-forget; logging failures are swallowed and never affect the user-facing request.
- **No log injection into the UI:** the details payload is rendered as inert text (`<pre>{JSON}</pre>`), never as HTML.
- **Bounded volume:** hot paths are excluded by design, so logging adds no per-request DB write to chat/AI/RAG traffic.

---

## 7. Source map

- Schema/migrations: `apps/core/prisma/schema.prisma`, `prisma/migrations/*_add_logging_subsystem`
- Facade & redaction: `app/lib/logging.server.ts`
- Data access: `app/lib/db.auditlog.server.ts`, `db.systemlog.server.ts`, `db.log-retention-policy.server.ts`
- Viewer: `app/routes/admin.logs.tsx`, `app/components/admin/logs-admin-view.tsx`
