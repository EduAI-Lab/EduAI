#!/usr/bin/env node
/**
 * Mock OpenAI/Ollama-compatible inference server for load testing.
 *
 * Stands in for vLLM (chat completions) and Ollama (embeddings) so the
 * stress harness never touches real model APIs or the campus GPU host.
 * Zero dependencies — plain `node:http` — so it never needs `npm install`.
 *
 * Endpoints:
 *   POST /v1/chat/completions   OpenAI-style, streaming + non-streaming
 *   GET  /v1/models             OpenAI-style model list (harmless stub)
 *   POST /api/embed             Ollama-native embeddings (fixed-length fake vectors)
 *   GET  /healthz               liveness check
 *
 * Env:
 *   MOCK_LLM_PORT        default 8801
 *   MOCK_TOKEN_DELAY_MS   per-chunk delay, default 15 (~65 tok/s, mid-range for a 7B model)
 *   MOCK_RESPONSE_WORDS   words in the canned reply, default 60
 *   MOCK_EMBED_DIM        default 1024 (must match EMBEDDING_DIMENSION)
 */
import http from 'node:http';

const PORT = Number(process.env.MOCK_LLM_PORT || 8801);
const TOKEN_DELAY_MS = Number(process.env.MOCK_TOKEN_DELAY_MS || 15);
const RESPONSE_WORDS = Number(process.env.MOCK_RESPONSE_WORDS || 60);
const EMBED_DIM = Number(process.env.MOCK_EMBED_DIM || 1024);

const CANNED_WORDS = (
  'Sure, here is a concise answer based on the course material we discussed. ' +
  'The key idea is to break the problem into smaller steps, verify each one, ' +
  'and check your assumptions before moving on. Let me know if you would like ' +
  'a worked example or a different explanation style.'
).split(' ');

function cannedReply(nWords) {
  const words = [];
  for (let i = 0; i < nWords; i++) words.push(CANNED_WORDS[i % CANNED_WORDS.length]);
  return words.join(' ');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function handleChatCompletions(req, res) {
  const body = await readBody(req).catch(() => ({}));
  const model = body.model || 'mock-model';
  const stream = body.stream !== false;
  const id = `chatcmpl-mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = Math.floor(Date.now() / 1000);
  const text = cannedReply(RESPONSE_WORDS);
  const words = text.split(' ');

  if (!stream) {
    await sleep(TOKEN_DELAY_MS * words.length);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id,
        object: 'chat.completion',
        created,
        model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: text },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 50,
          completion_tokens: words.length,
          total_tokens: 50 + words.length,
        },
      }),
    );
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const roleChunk = {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  };
  res.write(`data: ${JSON.stringify(roleChunk)}\n\n`);

  for (const word of words) {
    // Only the response's own state reflects a real client disconnect
    // (stop button / fetch abort). `req.destroyed` goes true as soon as the
    // *request* body finishes being read — normal for any POST — so
    // checking it here bailed out on the very first loop iteration and left
    // the connection open with no more data and no res.end().
    if (res.destroyed || res.writableEnded) return;
    await sleep(TOKEN_DELAY_MS);
    const chunk = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: { content: word + ' ' }, finish_reason: null }],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }

  const finalChunk = {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  };
  res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

function handleModels(res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      object: 'list',
      data: [
        { id: 'qwen2.5-7b-instruct', object: 'model', owned_by: 'mock' },
        { id: 'qwen2.5-32b-instruct', object: 'model', owned_by: 'mock' },
      ],
    }),
  );
}

function fakeVector(seedText) {
  // Deterministic pseudo-random vector so repeated calls for the same input
  // are stable — content doesn't matter for a stress test, only shape/speed.
  let seed = 0;
  for (let i = 0; i < seedText.length; i++) seed = (seed * 31 + seedText.charCodeAt(i)) >>> 0;
  const vec = new Array(EMBED_DIM);
  for (let i = 0; i < EMBED_DIM; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    vec[i] = (seed / 0xffffffff) * 2 - 1;
  }
  return vec;
}

async function handleEmbed(req, res) {
  const body = await readBody(req).catch(() => ({}));
  const input = body.input;
  const inputs = Array.isArray(input) ? input : [String(input ?? '')];
  await sleep(5 * inputs.length);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      model: body.model || 'mock-embed',
      embeddings: inputs.map((text) => fakeVector(String(text))),
    }),
  );
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      await handleChatCompletions(req, res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      handleModels(res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/embed') {
      await handleEmbed(req, res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found', path: url.pathname }));
  } catch (err) {
    console.error('[mock-llm] error', err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

server.listen(PORT, () => {
  console.log(`[mock-llm] listening on http://localhost:${PORT}`);
  console.log(`[mock-llm] token delay: ${TOKEN_DELAY_MS}ms, response words: ${RESPONSE_WORDS}, embed dim: ${EMBED_DIM}`);
});
