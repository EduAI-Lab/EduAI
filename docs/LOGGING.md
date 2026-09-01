# EduAI Core — Activity Logging

**Last updated:** 2026-08-31 (verified against `app/lib/logging.server.ts`, `db.auditlog.server.ts`, `db.systemlog.server.ts`, and `prisma/schema.prisma`)

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

Writes are **fire-and-forget** (`fireAndForget()` in `logging.server.ts`): a failed log write never blocks or fails the user request it describes, and the facade swallows its own errors before the extra `.catch` safety net.

Every audit/security row carries a **category** and an **outcome**:

- `AuditLogCategory` — `USER`, `INVITATION`, `COURSE`, `ENROLLMENT`, `MATERIAL`, `TOPIC`, `AI_CONFIG`, `CANVAS`, `BUG_REPORT`, `SECURITY`.
- `AuditLogOutcome` — `SUCCESS` (default), `FAILURE`, `DENIED`. Security denials are written as `DENIED`, so the audit stream is **not** success-only.

System rows carry `SystemLogLevel` (`ERROR`, `WARN`, `INFO`) and `SystemLogSource` (`ROUTE`, `AUTH`, `AI`, `CANVAS`, `MAIL`, `DB`, `SSR`, `API`).

---

## 2. What is logged

### Audit — administrative mutations

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
| Student profile updated | A student's profile (e.g. student number) was changed. |
| User TA courses changed | A user's TA course assignments were changed. |
| AI provider changed | An AI provider configuration was added, updated, or removed (`AI_PROVIDER_CREATED` / `_UPDATED` / `_DELETED`). |
| AI model changed | An AI model configuration was added, updated, or removed (`AI_MODEL_CREATED` / `_UPDATED` / `_DELETED`). |
| Provider config saved | A user's own provider settings were saved. |
| Routing model setting updated | An Auto-routing mode was enabled or disabled. |
| Chat daily limit settings updated | The per-role daily local-model quota was changed. |
| Bedrock overflow settings updated | The Bedrock overflow configuration was changed. |
| Embedding settings changed | The embedding configuration was modified. |
| Re-embed job created | A job to re-embed existing materials was queued. |
| Policy flag updated | An admin toggled a platform policy flag. |
| Canvas integration saved / deleted | Canvas LMS credentials were stored or removed. |
| Canvas read / quiz write / callback received | A Canvas API read, a quiz write, or an inbound Canvas callback. |
| Bug report status changed | The status of a bug report was updated. |
| Course deleted (cascade) | A course delete was propagated (`DELETE_COURSE`). |

The authoritative list is whatever `actionCode:` string literals exist in `apps/core/app/`:

```bash
grep -rhoE 'actionCode: "[A-Z_]+"' apps/core/app | sort -u
```

### Security — auth & access

| Event | What it records |
| --- | --- |
| Login success | A user authenticated successfully (`LOGIN_SUCCESS` / `LOGIN`). |
| Login failed | An authentication attempt was rejected (`LOGIN_FAILED` / `FAILED_LOGIN`). |
| Logout | A user ended their session. |
| Admin access denied | A non-admin was blocked from an admin-only resource (`ADMIN_ACCESS_DENIED`). |
| API key denied | An `x-api-key` request came from a non-admin, inactive, or unknown key owner (`API_KEY_DENIED`). |
| Invitation access denied | A caller without invitation authority hit an invitation endpoint (`INVITATION_ACCESS_DENIED`). |
| Policy denied | An action was blocked by an admin-disabled policy flag (`POLICY_DENIED`). |
| Canvas access denied | A user was blocked from a Canvas-gated resource. |
| Service key missing / invalid | A server-to-server request arrived without, or with a wrong, `EDUAI_API_KEY`. |
| Rate limit exceeded | A client tripped a rate limit (abuse signal). |

### System — errors

| Event | What it records |
| --- | --- |
| Mail send failed | An outbound email (e.g. an invitation) failed to send. |
| Material embed failed | A course material failed during embedding. |
| Outbound request failed | A call to an external service (Canvas, an AI provider, an extension) failed. |
| DB connect failed | The Prisma client could not reach Postgres. |

These are caught server-side failures, logged before re-throwing so behaviour is unchanged. `createSystemError` handles the DB-down case internally, so a logging failure during a database outage does not cascade.

### Not logged (data minimization)
High-volume product activity is **deliberately excluded from `audit_logs` / `system_logs`**: chat messages, AI generation, RAG retrieval, and assistive events. Ordinary reads/list views are not audited — only mutations and access-denials.

Those product surfaces have their **own** purpose-scoped tables, which are outside this subsystem and outside its retention policy:

| Table | Written by | Contains |
| --- | --- | --- |
| `chats` / `chat_messages` | `/api/chat` | Conversation content, owned by the user, deleted with the chat |
| `ai_interactions` | `routing/telemetry.server.ts` | Per-turn model/router/token/energy telemetry |
| `assistive_events` | `assistive-events.server.ts` | Assistive-Mode compliance metrics |
| `cron_job_runs` | the cron worker | Job status, duration, and captured output |

Treat those as separate PIA line items; this document covers only the three admin-facing streams above.

---

## 3. Personal data captured (PIA-relevant)

Each row may contain:

| Field | Personal data? | Notes |
| --- | --- | --- |
| `actorUserId`, `actorRole` | Yes (pseudonymous) | The acting user's ID and role. The **name** is shown in the UI via a live join to the user table, not stored on the log row. |
| `ipAddress` | Yes | Client IP derived from `x-forwarded-for` using a trusted-proxy hop count (see **Client IP derivation** below). Often null in local/dev. |
| `userAgent` | Yes | Browser/client string. |
| `entityId` / `entityLabel` | Sometimes | The affected record (e.g. a user or course ID). For identity-related events `entityLabel` holds the subject's **email** (for user events, formatted as `name <email>` so users who share a display name stay distinguishable). |
| `details` (JSON) | Minimized | Free-form context, **sanitized before write** (see below). |

**Redaction.** Before any `details` object is written, keys whose name contains `password`, `token`, `cookie`, `phone`, `authorization`, `secret` (covers `sessionSecret`/`clientSecret`), `apiKey`, `accessKey`, `privateKey`, or `credential` are replaced with `[REDACTED]`. Redaction recurses through nested objects, arrays, `Map`s, and `Set`s; circular references are replaced with `[CIRCULAR]`. **Passwords, tokens, secrets, and API keys are never stored.** Identifier keys explicitly allowed for accountability: `studentId`, `ubcEmployeeId`.

**Email addresses are stored** for identity-relevant events — login success/failure, logout, user created/updated/deleted, and invitation created/resent/revoked/accepted — so an admin can answer *who* without a fragile join (and, on a failed login, the attempted email is the only available subject identifier). This is a deliberate product decision recorded in `logging.server.ts`; `email` is intentionally **not** in the redaction deny-list. Re-adding `email` to that list restores full email redaction if a future privacy decision requires it.

**Actor attribution.** If an actor's user record is later deleted, the log's `actorUserId` is nulled (`ON DELETE SET NULL`) but the `actorRole` captured at write time is retained, so the event remains attributable by role without retaining a foreign key to a deleted person.

**Client IP derivation (trusted proxy).** `ipAddress` is derived in `app/lib/request-context.server.ts` from the **last** `x-forwarded-for` (XFF) entry. XFF is appended left-to-right, so the **leftmost** token is client-controlled and forgeable while the **rightmost** token is the one our own reverse proxy wrote. The deployment runs behind exactly one trusted proxy — Apache `ProxyPass` to Node on `localhost`, no Cloudflare or second proxy, Node not directly reachable (see [DEPLOYMENT.md](./DEPLOYMENT.md)). Apache's mod_proxy appends the real socket-peer address as the last entry, so a spoofed `X-Forwarded-For: 1.2.3.4` arrives as `1.2.3.4, <real-client>` and we record the real client.

- `x-real-ip` and `cf-connecting-ip` are **not** honored — Apache never sets them, so trusting them would only add a client-forgeable spoof vector.
- With no proxy in front (local dev), XFF is absent and `ipAddress` is `null`. The socket peer IP is not recoverable under `react-router-serve`, so a trusted proxy is a **hard requirement** for reliable IP attribution in production.
- **If a second proxy is ever added**, the rightmost entry would become that proxy's IP rather than the client; the selection here (and its tests) must be updated as part of that deployment change.

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

- Schema/migrations: `apps/core/prisma/schema.prisma` (`AuditLog`, `SystemLog`, `LogRetentionPolicy`), `prisma/migrations/*_add_logging_subsystem`
- Facade: `app/lib/logging.server.ts` (`logAuditAction`, `logSecurityEvent`, `logSystemError`, `fireAndForget`)
- Redaction: `app/lib/redact.server.ts` (`sanitizeSensitiveData`, `redactErrorForConsole`, `redactErrorForMessage`, `redactSecretValuesInString`)
- Request/actor context: `app/lib/request-context.server.ts` (`getRequestContext`, `getActorContext`)
- Data access: `app/lib/db.auditlog.server.ts`, `db.systemlog.server.ts`, `db.log-retention-policy.server.ts`
- Viewer: `app/routes/admin.logs.tsx`, `app/components/admin/logs-admin-view.tsx`
