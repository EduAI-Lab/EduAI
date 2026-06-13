# EduAI MCP spike (#573)

Minimal **stdio** MCP server with one tool: `list_courses`. It calls Core
`GET /api/courses` using `EDUAI_API_KEY` — the same service-key path AI Tutor
and Question Maker use for server-to-server calls.

This is a **local prototype only**. Production MCP Host Server work is tracked
in GitHub [#574](https://github.com/EduAI-Lab/EduAI/issues/574) (September).

Design context: [`docs/rag-ai/MCP_INTEGRATION_PLAN.md`](../../docs/rag-ai/MCP_INTEGRATION_PLAN.md)

## Prerequisites

- Core running locally (default `http://localhost:3000`)
- `EDUAI_API_KEY` set to match Core's env

## Install and run

```bash
cd tools/mcp-spike
npm install
CORE_URL=http://localhost:3000 EDUAI_API_KEY=your-key npm start
```

The process speaks MCP over stdio. Configure Cursor or Claude Desktop to spawn
this command as an MCP server.

### Example Cursor MCP config

```json
{
  "mcpServers": {
    "eduai-spike": {
      "command": "node",
      "args": ["C:/path/to/EduAICoreLearning/tools/mcp-spike/index.mjs"],
      "env": {
        "CORE_URL": "http://localhost:3000",
        "EDUAI_API_KEY": "your-service-key"
      }
    }
  }
}
```

## Tool

| Tool | Backing | Auth |
| ---- | ------- | ---- |
| `list_courses` | `GET /api/courses` | `Authorization: Bearer EDUAI_API_KEY` |

September MCP tools will call `lib/*` handlers directly instead of HTTP
loopback; this spike validates the MCP SDK wiring and service-key path only.
