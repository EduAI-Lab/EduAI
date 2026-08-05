import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getRepoStatus } from "./lib.mjs";

const execFileAsync = promisify(execFile);
const webhookUrl = process.env.DISCORD_WEBHOOK_URL?.trim();
const repo = process.env.EDUAI_REPO?.trim() || process.cwd();

if (!webhookUrl) {
  throw new Error("DISCORD_WEBHOOK_URL is required");
}

const status = await getRepoStatus(repo);
const actor = process.env.DEPLOY_ACTOR?.trim() || process.env.USER || "manual deploy";
const content = [
  `🟢 **Dev server updated**`,
  `Branch: \`${status.branch}\``,
  `Commit: \`${status.sha}\``,
  `By: ${actor}`,
].join("\n");

const response = await fetch(`${webhookUrl}?wait=true`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    content,
    allowed_mentions: { parse: [] },
  }),
});

if (!response.ok) {
  throw new Error(`Discord webhook returned HTTP ${response.status}`);
}

// Confirm the local checkout is still readable after the network call.
await execFileAsync("git", ["-C", repo, "rev-parse", "--is-inside-work-tree"]);
console.log(`Reported ${status.branch}@${status.sha} to Discord.`);
