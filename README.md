# EduAI

A production-ready chat platform with Retrieval-Augmented Generation (RAG) capabilities designed for plug-and-play usage. Seamlessly integrate course-aware Q&A functionality with support for multiple AI providers including Ollama, Google Gemini, and OpenAI.

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

API key usage is restricted to admins. Create API keys through the web interface under Settings > API Keys. Requests that include `x-api-key` require the authenticated user to have role `ADMIN` across `/api/*`. Non-admin users should access features via the web UI with their session cookies.

## API Documentation

Note on authentication: Using `x-api-key` is restricted to ADMIN users across all `/api/*` endpoints. Non-admin users should access functionality via the web UI with their session cookies. Any request that includes `x-api-key` from a non-admin user returns 403.

### Testing Admin-Only x-api-key

- Admin key, expect success (200/201/… depending on route):
  - `curl -i -X GET "https://eduai.ok.ubc.ca/api/ai-providers" -H "x-api-key: ADMIN_API_KEY"`
- Non-admin key, expect 403 Forbidden:
  - `curl -i -X GET "https://eduai.ok.ubc.ca/api/ai-providers" -H "x-api-key: STUDENT_API_KEY"`
- Chat via curl (admin only with key):
  - `curl -i -X POST "https://eduai.ok.ubc.ca/api/chat" -H "Content-Type: application/json" -H "x-api-key: ADMIN_API_KEY" -d '{"messages":[{"role":"user","content":"hello"}],"model":"google:gemini-2.5-flash","apiKeys":{"google":{"apiKey":"YOUR_GOOGLE_API_KEY","isEnabled":true}},"streaming":false}'`
- Chat via UI (students): use browser at `/chat`; no `x-api-key` sent; should work as before.

### Chat Endpoint

Send chat messages with course context for grounded responses.

#### Request

**Endpoint**: `POST /api/chat`

**Headers**:
- `Content-Type: application/json`
- `x-api-key: YOUR_API_KEY` (admin only; requests with this header require an ADMIN user)

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
  -H "x-api-key: YOUR_API_KEY" `
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
  -H "x-api-key: YOUR_API_KEY" \
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
  -H "x-api-key: YOUR_API_KEY" \
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

### Course Topics Endpoint

Manage topics for a specific course. Admin role required for creating and deleting topics.

#### Request

**Endpoints**: 
- `GET /api/courses/:courseId/topics` - List all topics
- `POST /api/courses/:courseId/topics` - Create a topic (admin only)
- `DELETE /api/courses/:courseId/topics` - Delete a topic (admin only)

**Headers**:
- `Content-Type: application/json`
- `x-api-key: YOUR_API_KEY`

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
  -H "x-api-key: YOUR_API_KEY"
```

##### Get Course Topics (Linux/macOS)
```bash
curl -X GET "https://eduai.ok.ubc.ca/api/courses/COURSE_ID/topics" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY"
```

##### Create Course Topic (Windows - PowerShell)
```powershell
curl -X POST "https://eduai.ok.ubc.ca/api/courses/COURSE_ID/topics" `
  -H "Content-Type: application/json" `
  -H "x-api-key: YOUR_API_KEY" `
  -d '{
    "name": "Introduction to Machine Learning"
  }'
```

##### Create Course Topic (Linux/macOS)
```bash
curl -X POST "https://eduai.ok.ubc.ca/api/courses/COURSE_ID/topics" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "name": "Introduction to Machine Learning"
  }'
```

##### Delete Course Topic (Windows - PowerShell)
```powershell
curl -X DELETE "https://eduai.ok.ubc.ca/api/courses/COURSE_ID/topics" `
  -H "Content-Type: application/json" `
  -H "x-api-key: YOUR_API_KEY" `
  -d '{
    "topicId": "TOPIC_ID"
  }'
```

##### Delete Course Topic (Linux/macOS)
```bash
curl -X DELETE "https://eduai.ok.ubc.ca/api/courses/COURSE_ID/topics" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "topicId": "TOPIC_ID"
  }'
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes
4. Submit a pull request
