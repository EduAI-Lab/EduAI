/*
  Integration test runner for RAG endpoints.
  Usage:
    RAG_BASE_URL=http://localhost:5173 tsx scripts/run-rag-tests.ts
  or:
    npm run test:rag

  Prereqs:
    - Postgres running and PG* env vars set (same as the app)
    - Ollama running with required models OR OpenAI configured
    - App server running at RAG_BASE_URL
*/

type JSONObject = Record<string, any>;

const BASE = process.env.RAG_BASE_URL || "http://localhost:5173";
const COURSE_ID = Number(process.env.RAG_TEST_COURSE_ID || 123);
const ALT_COURSE_ID = Number(process.env.RAG_TEST_ALT_COURSE_ID || 456);

async function wait(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function waitForHealthy(timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  let lastErr: any;
  while (Date.now() < end) {
    try {
      const r = await fetch(`${BASE}/api/chatbot`);
      if (r.ok) return true;
      lastErr = `status ${r.status}`;
    } catch (e) {
      lastErr = e;
    }
    await wait(500);
  }
  throw new Error(`Service not healthy at ${BASE} (${String(lastErr)})`);
}

async function getJson(path: string) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return (await r.json()) as JSONObject;
}

async function postJson(path: string, body: JSONObject) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`${path} -> HTTP ${r.status} ${t}`);
  }
  return (await r.json()) as JSONObject;
}

function assert(cond: any, msg: string) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

async function run() {
  const results: string[] = [];
  const pass = (name: string) => results.push(`PASS ${name}`);

  // 0) Health
  await waitForHealthy();
  const health = await getJson(`/api/chatbot`);
  assert(health.status === "ok", "health status ok");
  pass("health");

  // 1) Ingest raw text (chunking + embeddings + vector-store)
  const ingest = await postJson(`/api/chatbot/document/${COURSE_ID}`, {
    documentText:
      "## Intro\nLarge Language Models help with Q&A. They retrieve chunks and answer.",
    metadata: { source: "unit-test", name: "intro.txt", type: "txt" },
    prefix: "(Course A)",
  });
  assert(Array.isArray(ingest) && ingest.length > 0, "ingest returns entries");
  pass("ingest raw text");

  // 2) List chunks
  const chunks = await getJson(`/api/chatbot/document/${COURSE_ID}`);
  assert(Array.isArray(chunks) && chunks.length > 0, "chunks exist");
  pass("list chunks");

  // 3) Ask RAG question
  const ask = await postJson(
    `/api/chatbot/chatbot/${COURSE_ID}/ask?skipSimilaritySearch=false`,
    { question: "What do LLMs do in this course?", history: [] }
  );
  assert(ask && ask.answer, "ask returns answer");
  pass("ask");

  // 4) URL ingestion (aggregate doc)
  const urlDoc = await postJson(`/api/chatbot/document/${COURSE_ID}/url`, {
    url: "https://raw.githubusercontent.com/ossf/scorecard/main/README.md",
  });
  assert(urlDoc && urlDoc.docId, "url ingest returns docId");
  pass("url ingestion");

  // 5) List aggregates
  const aggregates = await getJson(
    `/api/chatbot/document/aggregate/${COURSE_ID}`
  );
  assert(Array.isArray(aggregates) && aggregates.length > 0, "aggregates exist");
  pass("list aggregates");

  // 6) Insert QA and list
  const qa = await postJson(`/api/chatbot/question/${COURSE_ID}`, {
    question: "What is RAG?",
    answer: "RAG retrieves relevant chunks and grounds an LLM answer.",
    verified: true,
    suggested: false,
    sourceDocuments: [],
  });
  assert(qa && qa.id, "question inserted");
  const allQ = await getJson(`/api/chatbot/question/${COURSE_ID}/all`);
  assert(Array.isArray(allQ) && allQ.length > 0, "questions listed");
  pass("question add/list");

  // 7) Course scoping sanity: alt course should have no chunks
  const altChunks = await getJson(`/api/chatbot/document/${ALT_COURSE_ID}`);
  assert(Array.isArray(altChunks) && altChunks.length === 0, "scoping works (no leakage)");
  pass("scoping");

  // 8) Simple query (no retrieval)
  const q = await postJson(`/api/chatbot/query`, { query: "Say hello" });
  assert(q && q.answer, "query returns answer");
  pass("query");

  console.log(results.join("\n"));
  console.log("\nAll tests passed.");
}

run().catch((e) => {
  console.error("TESTS FAILED:\n", e?.stack || e);
  process.exit(1);
});


