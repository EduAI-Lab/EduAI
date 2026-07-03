#!/usr/bin/env node
import { readFileSync } from "node:fs";

const url = process.env.RESEARCH_RUN_URL;
const cookie = process.env.RESEARCH_RUN_COOKIE;
const keysFile = process.env.RESEARCH_RUN_API_KEYS_FILE;
if (!url || !cookie || !keysFile) {
  console.error("Need RESEARCH_RUN_URL, RESEARCH_RUN_COOKIE, RESEARCH_RUN_API_KEYS_FILE");
  process.exit(1);
}
const apiKeys = JSON.parse(readFileSync(keysFile, "utf8"));
const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({
    model: "vllm:qwen2.5-32b-instruct",
    apiKeys,
    messages: [{ id: "1", role: "user", content: "Reply with one word: hello" }],
    streaming: false,
    forceHybridRag: true,
  }),
});
const text = await res.text();
console.log("status", res.status);
console.log(text.slice(0, 500));
