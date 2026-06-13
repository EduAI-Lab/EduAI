#!/usr/bin/env node
/**
 * EduAI MCP spike (#573) — stdio server with one tool: list_courses.
 * Calls Core GET /api/courses with EDUAI_API_KEY (service-key path).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const CORE_URL = (process.env.CORE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const SERVICE_KEY = process.env.EDUAI_API_KEY;

async function listCoursesFromCore() {
  if (!SERVICE_KEY) {
    throw new Error('EDUAI_API_KEY is required');
  }

  const response = await fetch(`${CORE_URL}/api/courses`, {
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Core returned ${response.status}`);
  }

  return response.json();
}

const server = new McpServer({
  name: 'eduai-mcp-spike',
  version: '0.1.0',
});

server.tool(
  'list_courses',
  'List EduAI courses via Core GET /api/courses (service key)',
  {},
  async () => {
    const data = await listCoursesFromCore();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
