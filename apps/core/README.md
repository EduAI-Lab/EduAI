# EduAI

A production-ready chat platform with Retrieval-Augmented Generation (RAG) capabilities designed for plug-and-play usage. Seamlessly integrate course-aware Q&A functionality with support for multiple AI providers including Ollama, Google Gemini, and OpenAI.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [API Documentation](#api-documentation)
- [Testing](#testing)
- [Contributing](#contributing)

## Features

- **Configurable Permissions**: Admins toggle role-based capabilities at runtime from an ADMIN-only page at `/admin/settings` — backed by a `SystemConfig` policy registry and exposed over `GET /api/policies` (service key for the extension apps, ADMIN session for the dashboard; any authenticated user may read the flag *values* so the UI mirrors backend gates). Each flag live-gates both backend enforcement (403 / hidden data) and the matching UI control with no redeploy, and a flag-caused 403 emits a structured `{"event":"policy_denied",...}` audit line. The registry covers:
  - **Instructor gates** (default on): `instructors.canCreateCourses` (Core + AI Tutor), `instructors.canPublishCourses`, `instructors.canManageEnrollments`, `instructors.canManageCanvasIntegration`, `instructors.canDeleteCourses`.
  - **TA gates / grants**: `tas.canManageMaterials` (gate, default on — upload **and** delete), `tas.canSetAiInstructions` (grant, default off — edit a course's AI-instructions field only), `tas.canManageTopics` (grant, default off — full topic CRUD).
  - **Student grants** (default off): `students.canUploadMaterials`; plus `students.canViewMaterials` (gate, default on).
  - **Unit-admin gates**: `unitAdmins.canDeleteCourses` (default on; ADMIN always allowed); `unitAdmins.canInvite` (grant, default off) — lets a UNIT_ADMIN invite instructors and students (see Unit-Admin Invitations below).
  - **Chat visibility** (grants, default off): `instructors.canViewCourseChats`, `unitAdmins.canViewUnitChats` — read student chats in a course / across a unit (new `Chats` tab and unit chats view, backed by `GET /api/courses/:id/chats` and `GET /api/units/:department/chats`).
  - **Web tools master**: `chat.webToolsEnabled` (default off) — global on/off for chat web search/fetch for every role. Folds in the former standalone `webToolsEnabled` toggle.
  - **Public registration master**: `auth.allowPublicRegistration` (default on) — gates email/password self-signup at the Better Auth `sign-up/email` chokepoint and hides the signup UI; invitation acceptance and OAuth/SSO are unaffected.
- **Admin Invitations**: Admins onboard ADMIN / UNIT_ADMIN / INSTRUCTOR users via emailed one-time accept links (`/admin/invitations`) — the invitee sets a password and lands signed in with the invited role; links can be revoked or re-sent (token rotation)
- **Unit-Admin Invitations**: When the `unitAdmins.canInvite` flag is on, unit admins get a dedicated `/unit-admin/invitations` page (and a policy-gated nav link that disappears when the flag is off) to invite INSTRUCTOR and STUDENT users only. They see and manage just the invites they sent; the flow reuses the same `/api/invitations` endpoints, emails, and accept page as the admin flow
- **UBC Email Enforcement**: Public self-registration and admin/unit-admin invitations only accept UBC email addresses — the domain must be `ubc.ca` or a subdomain of it (`student.ubc.ca`, `mail.ubc.ca`, department subdomains). Enforced backend-side by a shared `isUbcEmail` gate at the sign-up schema, the Better Auth `sign-up/email` before-hook, and the invitation schema; invitation acceptance reuses the already-validated address
- **Activity Logging**: Administrative mutations and security events (logins, access denials, rate-limit trips) are recorded to `audit_logs` and server errors to `system_logs`, with credential- and PII-shaped fields redacted before write; admins review them in an ADMIN-only viewer at `/admin/logs` with a configurable retention policy (see [docs/LOGGING.md](../../docs/LOGGING.md))
- **Multi-Provider AI Support**: Switch between Ollama (local), Google Gemini, and OpenAI with a single configuration change
- **Retrieval-Augmented Generation**: Ground responses in course materials with source citations to minimize hallucinations
- **Tool Calling**: Enhanced information retrieval through integrated RAG tools
- **Real-time Streaming**: Server-sent events for responsive chat experiences
- **Course Isolation**: Separate vector indexes and metadata per course for optimal relevance
- **Simple Integration**: Clean REST API endpoints for easy integration
- **Vector Storage**: PGVector-powered embeddings on PostgreSQL for efficient similarity search
- **Role-based Access**: Support for students, professors, and administrators
- **Persisted Chat Preferences**: Assistive mode and the selected course are saved per user, restored on every page load and new chat, and cleared on logout
- **Admin Chatbot**: ADMIN-only assistant at `/admin/chat` (`chatMode: "admin"`) with confirmed write tools, exact user/enrollment lookups, and 16k-context token budgeting for vLLM
- **Account-level Assistive Mode**: Shell-wide `AssistiveUiProvider` sets `data-assistive` on `<html>` when ON (absent when OFF so baseline CSS is unchanged); preference persists via `UserPreference.assistDefault` and syncs with the `/chat` header toggle
- **Assistive active highlighting**: On `/chat`, emphasizes the latest assistant reply, de-emphasizes older messages, anchors the composer, auto-focuses input after responses, and offers optional focus mode to hide non-essential chrome

## Prerequisites

- Node.js 18+
- PostgreSQL with PGVector extension
- Docker (optional, for containerized database)

## Installation

### Local Development Setup

1. **Clone the monorepo**
   ```bash
   git clone <EduAICore monorepo URL>
   cd EduAICore
   ```

2. **Install dependencies (from monorepo root)**
   ```bash
   npm ci
   ```

3. **Database Setup**
   - Ensure PostgreSQL is running with PGVector extension enabled
   - Copy environment configuration:
     ```bash
     cp .env.example .env
     ```

4. **Database Migration**
   ```bash
   npm run db:migrate
   ```

5. **Seed Database**
   ```bash
   npm run db:seed
   ```

6. **Start Development Server**
   ```bash
   npm run dev
   ```

## Configuration

Configure the following environment variables in your `.env` file:

```env
NODE_ENV="development"

DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"

# Better Auth Config
BETTER_AUTH_SECRET="" # REQUIRED: Generate a strong random secret (e.g., `openssl rand -base64 32`)
BETTER_AUTH_URL="http://localhost:5173" # Base URL of your app

OPENROUTER_API_KEY="" # Embeddings — see docs/rag-ai/EMBEDDINGS.md (local Ollama or cloud 1024-dim)
GOOGLE_GENERATIVE_AI_API_KEY="" # Direct Gemini embeddings (legacy 3072 path only)
EMBEDDING_PROVIDER="local" # local | cloud — dev server uses Ollama mxbai-embed-large
EMBEDDING_DIMENSION="1024" # Must match pgvector column (LOCAL-EMBEDDINGS)
OLLAMA_EMBEDDING_MODEL="mxbai-embed-large"
OLLAMA_BASE_URL="http://localhost:11434/"  # dev server: http://cmps01.ok.ubc.ca:11434
# VLLM_PORT=8001
# VLLM_BASE_URL="http://cmps01.ok.ubc.ca:8001"  # after IT firewall; see docs/rag-ai/VLLM.md
# Multi-server fleet (optional) — see docs/DEPLOYMENT.md:
# VLLM_FLEET_CHAT_URLS="http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001"
# VLLM_FLEET_HEAVY_URL="http://cmps03.ok.ubc.ca:8001"
# npm run fleet:smoke  # from apps/core — pre-flight health check
FIRECRAWL_API_KEY="" # Required for Firecrawl web search tool. If not set, web search is unavailable.

# Canvas instructor API tokens (AES-256-GCM; same format as Question Maker ENCRYPTION_KEY)
ENCRYPTION_KEY="" # REQUIRED for POST /api/canvas/connect — generate e.g. openssl rand -hex 32

# Invitation emails (optional — when SMTP_HOST is unset, the accept link is logged
# to the console and shown in the admin UI instead of being emailed)
SMTP_HOST=""
SMTP_PORT="587"
SMTP_SECURE="false" # true for implicit TLS (port 465)
SMTP_USER=""
SMTP_PASS=""
EMAIL_FROM="EduAI <no-reply@eduai.local>"
INVITE_EXPIRY_HOURS="72" # invitation link lifetime in hours

# ADHD Assist Phase 3 oversight — second-pass structural audit when Assistive Mode is ON (default: enabled)
# ADHD_ASSIST_OVERSIGHT="false"              # Set to false/0/off to disable rewrite pass
```

## Usage

### Web Interface

1. Navigate to the application in your browser
2. Create an account (default role: student)
3. Sign in to access the dashboard
4. Upload course materials or select existing courses
5. Start chatting with course-aware AI assistance

### Programmatic Access

Core API routes authenticate via **session cookie** (user-context calls) or **`Authorization: Bearer <EDUAI_API_KEY>`** service key (server-to-server calls). The legacy `x-api-key` Better Auth API-key plugin has been removed (#158). Extensions should use `getEduAiCookieForRequest` for user-context calls and the `EDUAI_API_KEY` service key for server-to-server calls.

## API Documentation

Note on authentication: User-facing routes require a valid session cookie. Server-to-server calls from extensions use `Authorization: Bearer <EDUAI_API_KEY>`. See `app/lib/auth/guards.server.ts` (`requireServiceKey`) for the service-key implementation.

### Chat Endpoint

Send chat messages with course context for grounded responses.

#### Request

**Endpoint**: `POST /api/chat`

**Headers**:
- `Content-Type: application/json`
- `Cookie: <session cookie>` (auth via session; use `--cookie` in curl or a browser session)

**Body Parameters**:
- `messages` (array): Chat message history
- `model` (string): AI model identifier
- `apiKeys` (object): Provider-specific API keys
- `courseCode` (string): Target course identifier (required for learning chat; omitted for admin chat)
- `chatMode` (string, optional): `"learning"` (default) or `"admin"`. Admin mode is ADMIN-only (`/admin/chat`), uses a separate `ChatbotType.ADMIN` session, and requires a tool-capable model. Learning mode remains course-scoped RAG chat.
- `streaming` (boolean): Enable response streaming
- `adhdAssist` (boolean, optional): Opt-in flag persisted on `Chat.adhdAssist` (default `false`). When `true`, the resolved system prompt is prepended with the verbatim ADHD Assist policy block from `docs/literature/adhd-assist-prompt-policy.md` §3 before being passed to `streamText`. Style is the only IV — model, retrieval, tools, temperature, and streaming behavior are unchanged. UI toggle lives at the top of the chat header on `/chat`. If the field is omitted from the request body, the request falls back to the persisted `Chat.adhdAssist` for the resolved chat — same precedence pattern as `systemPrompt`. If the field is present, it overrides the persisted value (and updates it). When Assist is ON, Phase 3 oversight (`ADHD_ASSIST_OVERSIGHT` env, default enabled) audits the full draft for structural compliance (`**Top summary**`, `**Next?**`, word cap) before emit; set `ADHD_ASSIST_OVERSIGHT=false` to disable the rewrite pass.

**Admin chat (`chatMode: "admin"`)**:
- Write tools only mutate after the admin confirms in chat and the model retries with `confirmed: true`. Write-safety rules are always appended to the system prompt — including when a custom `systemPrompt` is set.
- List tools keep payloads small for 16k-context vLLM models (default 25 rows, max 50). Use `listUsers` with `email` / `query`, and `listCourseEnrollments` with `userId` / `userEmail`, for exact lookups so older rows outside the newest page stay reachable for update/deactivate flows.
- On ≤16k windows the route reserves tool-schema + mid-turn tool-result headroom, re-caps `maxTokens` after the security prompt, and returns `400 ADMIN_CONTEXT_TOO_LARGE` when the prompt still cannot fit.

#### Examples

##### Windows (PowerShell)
```powershell
curl -X POST "https://eduai.ok.ubc.ca/api/chat" `
  -H "Content-Type: application/json" `
  -H "Cookie: YOUR_SESSION_COOKIE" `
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "What are the key concepts?"
      }
    ],
    "model": "google:gemini-2.5-flash",
    "apiKeys": {
      "google": {
        "apiKey": "YOUR_GOOGLE_API_KEY",
        "isEnabled": true
      }
    },
    "courseCode": "DATA 301",
    "streaming": false
  }'
```

##### Linux/macOS (Bash)
```bash
curl -X POST "https://eduai.ok.ubc.ca/api/chat" \
  -H "Content-Type: application/json" \
  -H "Cookie: YOUR_SESSION_COOKIE" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "What are the key concepts?"
      }
    ],
    "model": "google:gemini-2.5-flash",
    "apiKeys": {
      "google": {
        "apiKey": "YOUR_GOOGLE_API_KEY",
        "isEnabled": true
      }
    },
    "courseCode": "DATA 301",
    "streaming": false
  }'
```

##### Ollama Example (Linux/macOS)
```bash
curl -X POST "https://eduai.ok.ubc.ca/api/chat" \
  -H "Content-Type: application/json" \
  -H "Cookie: YOUR_SESSION_COOKIE" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "What are the key concepts?"
      }
    ],
    "model": "ollama:gpt-oss:120b",
    "apiKeys": {
      "ollama": {
        "isEnabled": true
      }
    },
    "courseCode": "DATA 301",
    "streaming": true
  }'
```

#### Chat History & Message Persistence

- The backend now stores every chat turn in the `chat_messages` table. Clients only need to send the newest user message plus the `chatId`; the API reconstructs context from the database and trims to the most recent 20 messages for inference.
- **Chat IDs**: The `chatId` is strictly server-generated (CUID). Clients should not attempt to generate their own chat IDs.
- **Message IDs**: Clients **SHOULD** generate a UUID v4 for every message (`message.id`) before sending it. This enables optimistic UI updates and allows the server to deduplicate retries safely.
- If a client references a `chatId` that no longer exists for that user, the API returns `410 Gone` with `{ "chatDeleted": true }`. Callers should drop the stale ID and start a new chat.
- **Route-based resume**: Saved chats are opened through `/chat/:chatId`. The route is the source of truth for the active conversation, so refreshing or directly visiting a saved-chat URL restores that chat instead of relying on browser `sessionStorage`.

### AI Models Endpoint

Retrieve the catalog of configured AI models.

#### Request

**Endpoint**: `GET /api/ai-models`

**Headers**:
- `Content-Type: application/json`
- `Cookie: <session>` (ADMIN role required)

#### Response

Returns an array of AI model objects, each including its associated provider metadata (`provider.name`, `providerId`, etc.).

#### Examples

##### Get AI Models (Windows - PowerShell)
```powershell
curl -X GET "https://eduai.ok.ubc.ca/api/ai-models" `
  -H "Content-Type: application/json" `
  -H "Cookie: YOUR_SESSION_COOKIE"
```

##### Get AI Models (Linux/macOS)
```bash
curl -X GET "https://eduai.ok.ubc.ca/api/ai-models" \
  -H "Content-Type: application/json" \
  -H "Cookie: YOUR_SESSION_COOKIE"
```

### Course Topics Endpoint

Manage topics for a specific course. Admin role required for creating and deleting topics.

#### Request

**Endpoints**: 
- `GET /api/courses/:courseId/topics` - List all topics
- `POST /api/courses/:courseId/topics` - Create a topic (admin only)
- `DELETE /api/courses/:courseId/topics` - Delete a topic (admin only)

**Headers**:
- `Content-Type: application/json`
- `Authorization: Bearer <EDUAI_API_KEY>` (service key; admin session cookie also accepted)

**URL Parameters**:
- `courseId` (string): Course identifier

**Body Parameters** (POST):
- `name` (string): Topic name

**Body Parameters** (DELETE):
- `topicId` (string, optional): Topic identifier
- `name` (string, optional): Topic name
- *Note: Either `topicId` or `name` must be provided*

#### Examples

##### Get Course Topics (Windows - PowerShell)
```powershell
curl -X GET "https://eduai.ok.ubc.ca/api/courses/COURSE_ID/topics" `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer YOUR_EDUAI_API_KEY"
```

##### Get Course Topics (Linux/macOS)
```bash
curl -X GET "https://eduai.ok.ubc.ca/api/courses/COURSE_ID/topics" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_EDUAI_API_KEY"
```

##### Create Course Topic (Windows - PowerShell)
```powershell
curl -X POST "https://eduai.ok.ubc.ca/api/courses/COURSE_ID/topics" `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer YOUR_EDUAI_API_KEY" `
  -d '{
    "name": "Introduction to Machine Learning"
  }'
```

##### Create Course Topic (Linux/macOS)
```bash
curl -X POST "https://eduai.ok.ubc.ca/api/courses/COURSE_ID/topics" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_EDUAI_API_KEY" \
  -d '{
    "name": "Introduction to Machine Learning"
  }'
```

##### Delete Course Topic (Windows - PowerShell)
```powershell
curl -X DELETE "https://eduai.ok.ubc.ca/api/courses/COURSE_ID/topics" `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer YOUR_EDUAI_API_KEY" `
  -d '{
    "topicId": "TOPIC_ID"
  }'
```

##### Delete Course Topic (Linux/macOS)
```bash
curl -X DELETE "https://eduai.ok.ubc.ca/api/courses/COURSE_ID/topics" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_EDUAI_API_KEY" \
  -d '{
    "topicId": "TOPIC_ID"
  }'
```

### User Preferences Endpoints

Read and update the authenticated user's UI preferences (`UserPreference` row). Requires a Better Auth **session cookie**. Used by `AssistiveUiProvider` in the app shell and the `/chat` assist toggle.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/preferences` | Returns `{ assistDefault, lastCourseCode, motionReduced, density, theme }` — defaults to `{ assistDefault: false, lastCourseCode: null, motionReduced: false, density: "comfortable", theme: "system" }` when no row exists |
| `PATCH` | `/api/preferences` | Partial update; accepts `assistDefault` (boolean), `lastCourseCode` (string or `null`), `motionReduced` (boolean), `density` (`comfortable` \| `compact`), and/or `theme` (`system` \| `light` \| `dark`) |

When `assistDefault` is `true`, the root layout sets `data-assistive="true"` on `<html>` for CSS scoping; when `false`, the attribute is **absent** (not `"false"`) so baseline styles are unchanged. Non-default `motionReduced`, `density`, and `theme` values set `data-reduce-motion`, `data-density="compact"`, or `light`/`dark` classes on `<html>`; defaults remove those hooks so OFF states stay pixel-identical.

**Settings → Accessibility tab:** `/settings` exposes Assistive Mode, reduce motion, density, and theme controls. Assistive Mode uses `AssistiveUiProvider`; motion/density/theme use `UiPreferencesProvider`. Both persist through `/api/preferences`.

**Assistive reading typography:** Elements marked with the `reading-surface` class (chat messages, course overview text, etc.) pick up spacing-only typography under `[data-assistive]` — 16px base, ~1.625 line-height, 65ch max measure, increased paragraph/letter spacing. No font-family swap; OFF state is pixel-identical because the attribute is absent.

**Active highlighting + focus mode (#525):** On `/chat` when `[data-assistive]` is set, the latest assistant message is emphasized (outline + background), older messages are de-emphasized (lower opacity, full opacity on hover/focus), the composer is subtly anchored, `:focus-visible` rings are strengthened, and the input auto-focuses after each assistant turn. **Focus mode** (header toggle and composer chip, independent of Assistive mode) sets `data-assistive-focus-mode` on `<html>` to hide the sidebar and course/model selectors. Client `re_orientation` events record re-orientation latency via `POST /api/assistive-events`.

**Chat markdown (Streamdown):** Assistant replies render through [Streamdown](https://streamdown.ai) with the `@streamdown/code` plugin for syntax-highlighted fenced blocks and copy/download controls. The plugin is lazy-loaded on the client (`packages/ui/src/ui/lazy-streamdown.tsx`) because it is ESM-only and would crash `react-router-serve` in the E2E Docker image if imported statically. Tailwind must scan hoisted Streamdown chunks — see `@source` entries in `apps/core/app/app.css`.

**Example** (browser session — toggle Assistive Mode on):

```javascript
fetch("/api/preferences", {
  method: "PATCH",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ assistDefault: true }),
});
```

The Settings Accessibility tab ships in #530 (`/settings` → Accessibility).

### Canvas Integration Endpoints

Store an instructor's Canvas personal access token on Core (encrypted at rest). Used for future roster sync and Canvas REST calls. Requires a Better Auth **session cookie**. Only users with role **`INSTRUCTOR`** or **`ADMIN`** may connect.

Set `ENCRYPTION_KEY` in `apps/core/.env` before calling connect (see [Configuration](#configuration)). Token format and local Canvas setup: [`docs/implementations/canvas-api-integration-guide.md`](../../docs/implementations/canvas-api-integration-guide.md) and [`docs/CANVAS.md`](../../docs/CANVAS.md).

On connect (non–test mode), Core probes `GET {canvasUrl}/api/v1/users/self/profile` before saving. Invalid tokens return `400`; unreachable Canvas returns `502`.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/canvas/integration` | Connection status (`canvasUrl`, `isTestMode`, `isConnected`) — **never returns the token** |
| `POST` | `/api/canvas/connect` | Save or update integration |
| `DELETE` | `/api/canvas/disconnect` | Remove integration |

**Connect body** (`POST /api/canvas/connect`):

```json
{
  "canvasUrl": "http://localhost:8080",
  "apiKey": "1234~your-personal-access-token",
  "isTestMode": false
}
```

In **test mode**, `apiKey` is optional (mock flows only).

#### Connect (browser console, logged in as instructor)

```javascript
fetch("/api/canvas/connect", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  credentials: "include",
  body: JSON.stringify({
    canvasUrl: "http://localhost:8080",
    apiKey: "YOUR_CANVAS_TOKEN",
  }),
}).then((r) => r.json()).then(console.log);
```

#### Check status

```javascript
fetch("/api/canvas/integration", { credentials: "include" })
  .then((r) => r.json())
  .then(console.log);
```

## Testing

Unit tests are written with [Vitest](https://vitest.dev/) and [Testing Library](https://testing-library.com/).

### Running tests

From the monorepo root:

```bash
cd apps/core
npm run test          # run all tests once
npm run test:watch    # watch mode
npm run typecheck     # TypeScript + React Router typegen
```

Run a single file:

```bash
npx vitest run app/tests/unit/LoginForm.test.tsx
```

### Folder structure

```
app/tests/
├── setup.ts                    # Global setup (jest-dom, ResizeObserver mock, matchMedia mock)
├── setup.integration.ts        # Integration-test env (e.g. DATABASE_URL)
├── globalSetup.ts              # DB migrate/seed before integration suite
├── integration/                # Route + DB tests (@vitest-environment node)
│   ├── courses.integration.test.ts
│   └── ...
└── unit/                       # Unit tests
    ├── LoginForm.test.tsx
    ├── AppSidebar.test.tsx
    ├── ApiKeySettings.test.tsx
    ├── CourseMaterialsUpload.test.tsx
    └── ...           # 29 component tests + lib/schema tests
```

**Component test coverage:** 29 domain components have dedicated RTL tests (all required components except three optional shadcn demo orphans: `section-cards`, `chart-area-interactive`, `data-table`).

See [`TESTS.md`](../../TESTS.md) at the monorepo root for the full test inventory.

### Notes

- The Vitest config (`vitest.config.ts`) uses `pool: vmThreads` and environment `jsdom`.
- If `npm run test` fails with `ERR_REQUIRE_ESM` from `html-encoding-sniffer`, that is a known jsdom 29 dependency issue in the monorepo — track fix separately; component test files themselves are valid.
- Tests must live under `app/tests/` and be named `*.test.ts` or `*.test.tsx`.

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes
4. Submit a pull request
