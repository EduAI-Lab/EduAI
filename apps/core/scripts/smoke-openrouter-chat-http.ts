/**
 * End-to-end dev-server smoke: sign-in + POST /api/chat with OpenRouter.
 * Run from apps/core: npx tsx scripts/smoke-openrouter-chat-http.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const coreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envText = fs.readFileSync(path.join(coreDir, ".env"), "utf8");
const openRouterKey = envText.match(/^OPENROUTER_API_KEY="?([^"\n]+)"?/m)?.[1]?.trim();
const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";

if (!openRouterKey) {
  console.error("OPENROUTER_API_KEY missing");
  process.exit(1);
}

const signInRes = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@eduai.local", password: "EduAI2026!" }),
});
const signInBody = await signInRes.json().catch(() => ({}));
console.log("sign-in", signInRes.status, signInBody?.user?.email || signInBody);

const setCookie = signInRes.headers.getSetCookie?.() ?? [];
const cookieHeader = setCookie.map((c) => c.split(";")[0]).join("; ");
const token = typeof signInBody?.token === "string" ? signInBody.token : "";

const chatHeaders: Record<string, string> = { "Content-Type": "application/json" };
if (cookieHeader) chatHeaders.Cookie = cookieHeader;
if (token) chatHeaders.Authorization = `Bearer ${token}`;

const chatRes = await fetch(`${baseUrl}/api/chat`, {
  method: "POST",
  headers: chatHeaders,
  body: JSON.stringify({
    messages: [{ role: "user", content: "Reply with one word: pong" }],
    model: "openrouter:google/gemini-2.5-flash",
    apiKeys: { openrouter: { apiKey: openRouterKey, isEnabled: true } },
    streaming: false,
  }),
});

const chatText = await chatRes.text();
console.log("chat", chatRes.status, chatText.slice(0, 1200));

if (!chatRes.ok) process.exit(1);
console.log("openrouter-chat-http-smoke: OK");
