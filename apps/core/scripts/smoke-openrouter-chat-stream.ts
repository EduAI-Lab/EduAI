/**
 * Smoke test streaming POST /api/chat with OpenRouter.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const coreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envText = fs.readFileSync(path.join(coreDir, ".env"), "utf8");
const openRouterKey = envText.match(/^OPENROUTER_API_KEY="?([^"\n]+)"?/m)?.[1]?.trim();
const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const model = process.argv[2] || "openrouter:google/gemini-2.5-flash";

if (!openRouterKey) {
  console.error("OPENROUTER_API_KEY missing");
  process.exit(1);
}

const signInRes = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@eduai.local", password: "EduAI2026!" }),
});
const signInBody = await signInRes.json();
const cookieHeader = signInRes.headers.getSetCookie?.().map((c) => c.split(";")[0]).join("; ") ?? "";
const token = typeof signInBody?.token === "string" ? signInBody.token : "";

const chatRes = await fetch(`${baseUrl}/api/chat`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Cookie: cookieHeader,
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    messages: [{ role: "user", content: "Say hi in one word" }],
    model,
    apiKeys: { openrouter: { apiKey: openRouterKey, isEnabled: true } },
    streaming: true,
  }),
});

console.log("stream status", chatRes.status, chatRes.headers.get("content-type"));
const body = await chatRes.text();
console.log(body.slice(0, 800));
if (!chatRes.ok || !body.includes("0:")) {
  process.exit(1);
}
console.log("stream-smoke: OK");
