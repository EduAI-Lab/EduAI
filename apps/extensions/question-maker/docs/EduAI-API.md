# EduAI

A production-ready chat platform with Retrieval-Augmented Generation (RAG) capabilities designed for plug-and-play usage. Seamlessly integrate course-aware Q&A functionality with support for multiple AI providers including Ollama, Google Gemini, and OpenAI.

> **Scope note:** this document describes EduAI Core's own API generally. It predates this
> repository's move into the EduAI monorepo and some of it (notably the chat endpoint path below) no
> longer matches how Core is actually deployed alongside Question Maker. For what Question Maker's own
> backend actually calls — verified against `app/backend/src/services/eduaiService.js` in this
> extension — see **"How Question Maker calls EduAI"** below; treat the rest of this file as background
> on Core, not as QM's own contract.

## How Question Maker calls EduAI

Question Maker's backend (`app/backend/src/services/eduaiService.js`) is a thin client around Core.
It never talks to a course's vector index directly — everything below goes through Core's HTTP API,
authenticated with `Authorization: Bearer <EDUAI_API_KEY>`, the caller's forwarded session cookie, or
both at once (Core needs the cookie to resolve a per-user Core-stored provider key even on a
service-key-authenticated call).

| QM calls | Purpose |
|---|---|
| `POST {EDUAI_API_URL}/api/completion` | The actual chat/generation endpoint (`eduaiService.chat()`). Stateless: QM sends `{ systemPrompt, messages, model, apiKeys, streaming, routingContext: { feature: "question-maker", jobType: "background" }, courseId?, courseCode? }` on every call and reconstructs no history — there is no `chatId` concept on QM's side. `generateQuestions()` builds a generation- or extraction-specific system prompt and calls this same endpoint. |
| `GET {EDUAI_API_URL}/api/ai-models?page=1&pageSize=200` | Model catalog (`listAIModels()`); QM falls back to a small hardcoded list (Gemini 2.5 Flash + the two campus vLLM sizes) if Core's catalog is empty or unreachable. |
| `GET {EDUAI_API_URL}/api/courses?...` | Course listing/search, used for the EduAI course picker and course-code resolution (paginated per Core's `#1041` contract — QM always sends `page`/`pageSize`, capped at 200). |
| `GET {EDUAI_API_URL}/api/courses/:courseId/topics` | Topic catalog for a linked course. |
| `GET/POST/DELETE /api/eduai/provider-settings` (proxied 1:1 from `app/frontend`) | Session-cookie-authenticated CRUD for a user's own AI provider key, stored and encrypted in Core (`services/coreApiService.js`'s `getUserProviderSettingsFromCore`/`upsertUserProviderSettingOnCore`). |
| Canvas `/api/canvas/*` routes | Not AI, but the same Core base URL/auth pattern — see [features/CANVAS_EXPORT.md](features/CANVAS_EXPORT.md). |

QM's own AI routes (`POST /api/eduai/chat`, `POST /api/eduai/generate-questions`,
`POST /api/questions/extract`, `POST /api/questions/generate`) all funnel through the calls above; see
[docs/DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) for the route-to-service map and
`middleware/aiAdmission.js` for the caller-scoped rate limit / provider-call budget / deadline every
one of them enforces before making a Core call.

---

## Core's general API (background, may not reflect the current deployment exactly)

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [API Documentation](#api-documentation)
- [Contributing](#contributing)

## Features

- **Multi-Provider AI Support**: Switch between Ollama (local), Google Gemini, and OpenAI with a single configuration change
- **Retrieval-Augmented Generation**: Ground responses in course materials with source citations to minimize hallucinations
- **Tool Calling**: Enhanced information retrieval through integrated RAG tools
- **Real-time Streaming**: Server-sent events for responsive chat experiences
- **Course Isolation**: Separate vector indexes and metadata per course for optimal relevance
- **Simple Integration**: Clean REST API endpoints for easy integration
- **Vector Storage**: PGVector-powered embeddings on PostgreSQL for efficient similarity search
- **Role-based Access**: Support for students, professors, and administrators

## Prerequisites

- Node.js 18+
- PostgreSQL with PGVector extension
- Docker (optional, for containerized database)

## Installation

### Local Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/mostafama/EduAICoreLearning.git
   cd EduAICoreLearning
   ```

2. **Install dependencies**
   ```bash
   npm install
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

GOOGLE_GENERATIVE_AI_API_KEY="" # For Embeddings
OLLAMA_BASE_URL="http://localhost:11434/"
FIRECRAWL_API_KEY="" # Required for Firecrawl web search tool. If not set, web search is unavailable.
```

## Usage

### Web Interface

1. Navigate to the application in your browser
2. Create an account (default role: student)
3. Sign in to access the dashboard
4. Upload course materials or select existing courses
5. Start chatting with course-aware AI assistance

### Programmatic Access

Core API routes authenticate via **session cookie** (user-context calls) or **`Authorization: Bearer <EDUAI_API_KEY>`** service key (server-to-server calls). The legacy `x-api-key` Better Auth API-key plugin has been removed (#158). Extensions should use `getEduAiCookieForRequest` for user-context calls and the `EDUAI_API_KEY` service key for server-to-server calls such as course and topic management.

## API Documentation

Note on authentication: User-facing routes require a valid session cookie. Server-to-server calls from extensions use `Authorization: Bearer <EDUAI_API_KEY>`. See `apps/core/app/lib/auth/guards.server.ts` (`requireServiceKey`) for the service-key implementation.

### Chat Endpoint

Send chat messages with course context for grounded responses.

#### Request

**Endpoint**: `POST /api/chat`

**Headers**:
- `Content-Type: application/json`
- `Cookie: YOUR_SESSION_COOKIE` (auth via session cookie)

**Body Parameters**:
- `messages` (array): Chat message history
- `model` (string): AI model identifier
- `apiKeys` (object): Provider-specific API keys
- `courseCode` (string): Target course identifier
- `streaming` (boolean): Enable response streaming

#### Examples

##### Windows (PowerShell)
```powershell
curl -X POST "https://eduai.ok.ubc.ca/api/chat" `
  -H "Content-Type: application/json" `
  -H "Cookie: YOUR_SESSION_COOKIE" `
  -d ‘{
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
  }’
```

##### Linux/macOS (Bash)
```bash
curl -X POST "https://eduai.ok.ubc.ca/api/chat" \
  -H "Content-Type: application/json" \
  -H "Cookie: YOUR_SESSION_COOKIE" \
  -d ‘{
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
  }’
```

##### Ollama Example (Linux/macOS)
```bash
curl -X POST "https://eduai.ok.ubc.ca/api/chat" \
  -H "Content-Type: application/json" \
  -H "Cookie: YOUR_SESSION_COOKIE" \
  -d ‘{
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
  }’
```

#### Chat History & Message Persistence

- The backend now stores every chat turn in the `chat_messages` table. Clients only need to send the newest user message plus the `chatId`; the API reconstructs context from the database and trims to the most recent 20 messages for inference.
- **Chat IDs**: The `chatId` is strictly server-generated (CUID). Clients should not attempt to generate their own chat IDs.
- **Message IDs**: Clients **SHOULD** generate a UUID v4 for every message (`message.id`) before sending it. This enables optimistic UI updates and allows the server to deduplicate retries safely.
- If a client references a `chatId` that no longer exists for that user, the API returns `410 Gone` with `{ "chatDeleted": true }`. Callers should drop the stale ID and start a new chat.

### AI Models Endpoint

Retrieve the catalog of configured AI models.

#### Request

**Endpoint**: `GET /api/ai-models`

**Headers**:
- `Content-Type: application/json`
- `Authorization: Bearer <EDUAI_API_KEY>` (service key; admin session cookie also accepted)

#### Response

Returns an array of AI model objects, each including its associated provider metadata (`provider.name`, `providerId`, etc.).

#### Examples

##### Get AI Models (Windows - PowerShell)
```powershell
curl -X GET "https://eduai.ok.ubc.ca/api/ai-models" `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer YOUR_EDUAI_API_KEY"
```

##### Get AI Models (Linux/macOS)
```bash
curl -X GET "https://eduai.ok.ubc.ca/api/ai-models" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_EDUAI_API_KEY"
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
- `Authorization: Bearer <EDUAI_API_KEY>` (service key)

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

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes
4. Submit a pull request
