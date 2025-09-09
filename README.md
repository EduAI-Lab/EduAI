# Welcome to React Router!

A modern, production-ready template for building full-stack React applications using React Router.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/remix-run/react-router-templates/tree/main/default)

## Features

- 🚀 Server-side rendering
- ⚡️ Hot Module Replacement (HMR)
- 📦 Asset bundling and optimization
- 🔄 Data loading and mutations
- 🔒 TypeScript by default
- 🎉 TailwindCSS for styling
- 📖 [React Router docs](https://reactrouter.com/)

## Getting Started

### Installation

Install the dependencies:

```bash
npm install
```

### Development

Start the development server with HMR:

```bash
npm run dev
```

Your application will be available at `http://localhost:5173`.

## Building for Production

Create a production build:

```bash
npm run build
```

## Deployment

### Docker Deployment

To build and run using Docker:

```bash
docker build -t my-app .

# Run the container
docker run -p 3000:3000 my-app
```

The containerized application can be deployed to any platform that supports Docker, including:

- AWS ECS
- Google Cloud Run
- Azure Container Apps
- Digital Ocean App Platform
- Fly.io
- Railway

### DIY Deployment

If you're familiar with deploying Node applications, the built-in app server is production-ready.

Make sure to deploy the output of `npm run build`

```
├── package.json
├── package-lock.json (or pnpm-lock.yaml, or bun.lockb)
├── build/
│   ├── client/    # Static assets
│   └── server/    # Server-side code
```

## Styling

This template comes with [Tailwind CSS](https://tailwindcss.com/) already configured for a simple default starting experience. You can use whatever CSS framework you prefer.

---

Built with ❤️ using React Router.

## Chat API

Use EduAI via HTTP.

- Endpoint: `POST /api/chat`
- Auth: x-api-key header (Better Auth API Key plugin) or session cookie
- Request body:
  - `messages`: array of `{ role: "user" | "assistant" | "system", content: string }`
  - `model`: `provider:model` (e.g. `openai:gpt-4o-mini`, `google:gemini-2.5-flash`)
  - `apiKeys`: provider configs containing your key(s)
  - `courseCode` (preferred): course code for RAG over uploaded materials
  - `courseId` (legacy): id-based RAG
- Response: streaming data (AI SDK data stream)

### 1) Create an API Key (via UI)

Go to Settings → API Keys in the app and create a key. Copy it once; it won't be shown again. Keys are managed by Better Auth's API Key plugin (see docs: https://www.better-auth.com/docs/plugins/api-key#how-does-it-work).

Or sign in and use session cookies.

### 2) Optional: Sign in (store cookies)

**PowerShell:**
```powershell
curl -i -X POST "http://localhost:5173/api/auth/sign-in/email" `
  -H "Content-Type: application/json" `
  -d '{"email":"you@example.com","password":"your-password"}' `
  -c cookies.txt
```

**Bash/Unix:**
```bash
curl -i -X POST "http://localhost:5173/api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-password"}' \
  -c cookies.txt
```

### 3) Chat (OpenAI)

**PowerShell:**
```powershell
curl -N -X POST "http://localhost:5173/api/chat" `
  -H "Content-Type: application/json" `
  -H "x-api-key: YOUR_API_KEY" `
  -d '{
    "messages": [
      { "role": "user", "content": "Explain backpropagation in simple terms." }
    ],
    "model": "openai:gpt-4o-mini",
    "apiKeys": {
      "openai": { "apiKey": "sk-your-openai-key", "isEnabled": true }
    }
  }'
```

**Bash/Unix:**
```bash
curl -N -X POST "http://localhost:5173/api/chat" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "messages": [
      { "role": "user", "content": "Explain backpropagation in simple terms." }
    ],
    "model": "openai:gpt-4o-mini",
    "apiKeys": {
      "openai": { "apiKey": "sk-your-openai-key", "isEnabled": true }
    }
  }'
```

### 4) Chat (Google Gemini)

**PowerShell:**
```powershell
curl -N -X POST "http://localhost:5173/api/chat" `
  -H "Content-Type: application/json" `
  -H "x-api-key: YOUR_API_KEY" `
  -d '{
    "messages": [
      { "role": "user", "content": "Give me 3 study tips for calculus." }
    ],
    "model": "google:gemini-2.5-flash",
    "apiKeys": {
      "google": { "apiKey": "your-gemini-key", "isEnabled": true }
    }
  }'
```

**Bash/Unix:**
```bash
curl -N -X POST "http://localhost:5173/api/chat" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "messages": [
      { "role": "user", "content": "Give me 3 study tips for calculus." }
    ],
    "model": "google:gemini-2.5-flash",
    "apiKeys": {
      "google": { "apiKey": "your-gemini-key", "isEnabled": true }
    }
  }'
```

### 5) Include course RAG (by courseCode)

**PowerShell:**
```powershell
curl -N -X POST "http://localhost:5173/api/chat" `
  -H "Content-Type: application/json" `
  -H "x-api-key: YOUR_API_KEY" `
  -d '{
    "messages": [
      { "role": "user", "content": "Summarize lecture 3 key ideas." }
    ],
    "model": "openai:gpt-4o-mini",
    "apiKeys": {
      "openai": { "apiKey": "sk-your-openai-key", "isEnabled": true }
    },
    "courseCode": "CS101"
  }'
```

**Bash/Unix:**
```bash
curl -N -X POST "http://localhost:5173/api/chat" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "messages": [
      { "role": "user", "content": "Summarize lecture 3 key ideas." }
    ],
    "model": "openai:gpt-4o-mini",
    "apiKeys": {
      "openai": { "apiKey": "sk-your-openai-key", "isEnabled": true }
    },
    "courseCode": "CS101"

### 6) Chat with Ollama (local)

PowerShell:
```powershell
curl -N -X POST "http://localhost:5173/api/chat" `
  -H "Content-Type: application/json" `
  -H "x-api-key: YOUR_API_KEY" `
  -d '{
    "messages": [
      { "role": "user", "content": "What is gradient descent?" }
    ],
    "model": "ollama:llama3.1",
    "apiKeys": {
      "ollama": { "isEnabled": true }
    }
  }'
```

Bash/Unix:
```bash
curl -N -X POST "http://localhost:5173/api/chat" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "messages": [
      { "role": "user", "content": "What is gradient descent?" }
    ],
    "model": "ollama:llama3.1",
    "apiKeys": {
      "ollama": { "isEnabled": true }
    }
  }'
```
  }'
```

Notes:
- Replace `http://localhost:5173` if deployed elsewhere.
- `curl -N` shows streamed tokens as they arrive.