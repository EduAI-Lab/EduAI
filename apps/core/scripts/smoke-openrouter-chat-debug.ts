import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const coreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envText = fs.readFileSync(path.join(coreDir, ".env"), "utf8");
const openRouterKey = envText.match(/^OPENROUTER_API_KEY="?([^"\n]+)"?/m)?.[1]?.trim();
const baseUrl = "http://127.0.0.1:3000";
const model = process.argv[2] || "openrouter:openai/gpt-4o";

const signInRes = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@eduai.local", password: "EduAI2026!" }),
});
const signInBody = await signInRes.json();
const cookieHeader = signInRes.headers.getSetCookie?.().map((c) => c.split(";")[0]).join("; ") ?? "";

const chatRes = await fetch(`${baseUrl}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookieHeader, Authorization: `Bearer ${signInBody.token}` },
  body: JSON.stringify({
    messages: [{ role: "user", content: "Say hi" }],
    model,
    apiKeys: { openrouter: { apiKey: openRouterKey, isEnabled: true } },
    streaming: false,
  }),
});
console.log(await chatRes.text());
