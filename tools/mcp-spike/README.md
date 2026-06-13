# EduAI MCP spike (#573)

Minimal **stdio** MCP server with one tool: `list_courses`. It calls Core
`GET /api/courses` using `EDUAI_API_KEY` — the same service-key path AI Tutor
and Question Maker use for server-to-server calls.

This is a **local prototype only**. Production MCP Host Server work is tracked
in GitHub [#574](https://github.com/EduAI-Lab/EduAI/issues/574) (September).

Design context: [`docs/rag-ai/MCP_INTEGRATION_PLAN.md`](../../docs/rag-ai/MCP_INTEGRATION_PLAN.md)

## Prerequisites

- Core running on dev (`http://127.0.0.1:3000` on the server; Apache proxies `https://dev.eduai.ok.ubc.ca`)
- `EDUAI_API_KEY` matching Core's env on dev
- **From your laptop:** UBC VPN (if needed) + SSH tunnel to Core (recommended), or direct HTTPS if reachable

## Install

```bash
cd tools/mcp-spike
npm install
```

## Dev server workflow (recommended)

Cursor runs the spike **on your laptop**. Core stays on dev. Use an SSH tunnel so the spike can reach Core without relying on public HTTPS from your machine.

**Terminal 1 — tunnel (leave running):**

```powershell
cd tools/mcp-spike
.\tunnel-dev-core.ps1
```

**Terminal 2 — test Core through the tunnel (PowerShell):**

```powershell
# PowerShell aliases `curl` to Invoke-WebRequest — use curl.exe
curl.exe -s -H "Authorization: Bearer YOUR_KEY" http://127.0.0.1:13000/api/courses
```

Set MCP env `CORE_URL=http://127.0.0.1:13000` (not the public HTTPS URL).

**Sync the service key from dev** (Core uses `EDUAI_API_KEY`, not `EDU_AI_API_KEY`):

```powershell
cd tools/mcp-spike
.\sync-mcp-key-from-dev.ps1
```

## Cursor MCP config (Windows)

Use the **`cmd /c` wrapper** — required on Windows to avoid Cursor's stdio/MessagePort spawn failures.

Project config: [`.cursor/mcp.json`](../../.cursor/mcp.json) (copy your dev `EDUAI_API_KEY` into `env`).

Or user config `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "eduai-spike": {
      "command": "cmd",
      "args": ["/c", "C:/Users/SyedS/Documents/UBCO Courses/URA/EduAICoreLearning/tools/mcp-spike/start.cmd"],
      "env": {
        "CORE_URL": "http://127.0.0.1:13000",
        "EDUAI_API_KEY": "your-dev-server-key"
      }
    }
  }
}
```

Then **reload MCP** in Cursor Settings (or restart Cursor). If you still see `Failed to acquire MessagePort`, restart Cursor fully — that error is a known Windows MCP host bug, often fixed by restart or disabling Core Isolation (Memory Integrity).

**Do not** run `npm start` manually in a terminal for Cursor use — Cursor spawns the process itself.

## Running on the dev server (SSH only)

`npm start` on the dev server over SSH does **not** connect to Cursor on your laptop (stdio is local to that SSH session). For Remote-SSH Cursor sessions opened on dev, use `CORE_URL=http://127.0.0.1:3000` instead.

## Tool

| Tool | Backing | Auth |
| ---- | ------- | ---- |
| `list_courses` | `GET /api/courses` | `Authorization: Bearer EDUAI_API_KEY` |

September MCP tools will call `lib/*` handlers directly instead of HTTP
loopback; this spike validates the MCP SDK wiring and service-key path only.
