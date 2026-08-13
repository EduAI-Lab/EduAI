import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const REPOSITORY = "EduAI-Lab/EduAI";
const PORT = Number(process.env.PR_NOTIFIER_PORT ?? 3101);
const DATA_DIR = process.env.PR_NOTIFIER_DATA_DIR ?? path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const DISCORD_HANDLES = JSON.parse(process.env.DISCORD_HANDLE_MAP ?? "{}");
let states = {};
const memberIds = new Map();

function required(name) { const value = process.env[name]?.trim(); if (!value) throw new Error(`Missing ${name}`); return value; }
const config = {
  token: required("DISCORD_TOKEN"), guildId: required("DISCORD_GUILD_ID"),
  channelId: required("DISCORD_PR_CHANNEL_ID"), secret: required("GITHUB_WEBHOOK_SECRET"),
  approvals: Number(process.env.PR_REQUIRED_APPROVALS ?? 2),
};
const key = (repo, number) => `${repo}#${number}`;
const now = () => new Date().toISOString();
const unique = (items) => [...new Set(items)];

async function loadState() {
  await mkdir(DATA_DIR, { recursive: true });
  try { states = JSON.parse(await readFile(STATE_FILE, "utf8")); } catch { states = {}; }
}
async function saveState() {
  const temporary = `${STATE_FILE}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify(states, null, 2));
  await rename(temporary, STATE_FILE);
}
function parseIssues(body = "") {
  return [...body.matchAll(/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:[\w.-]+\/[\w.-]+)?#(\d+)/gi)].map((match) => Number(match[1]));
}
function prState(pr, repo) {
  const id = key(repo, pr.number);
  const existing = states[id] ?? { id, reviewers: [], approvers: [], completedReviewers: [], reviewRequestedAtByReviewer: {}, reviewerReminderAtByReviewer: [], threadId: null };
  states[id] = { ...existing, repository: repo, number: pr.number, title: pr.title, url: pr.html_url, author: pr.user.login, assignees: (pr.assignees ?? []).map(({ login }) => login), open: pr.state === "open", draft: Boolean(pr.draft), sha: pr.head?.sha, linkedIssues: parseIssues(pr.body ?? ""), lastActivityAt: now() };
  return states[id];
}
function verifySignature(body, signature) {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", config.secret).update(body).digest("hex")}`;
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
async function discord(pathname, options = {}) {
  const response = await fetch(`https://discord.com/api/v10${pathname}`, {
    ...options, headers: { Authorization: `Bot ${config.token}`, "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) throw new Error(`Discord ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}
async function memberId(login) {
  const handle = DISCORD_HANDLES[login] ?? login;
  if (memberIds.has(handle)) return memberIds.get(handle);
  const members = await discord(`/guilds/${config.guildId}/members/search?limit=10&query=${encodeURIComponent(handle)}`, { method: "GET" });
  const match = members.find(({ user }) => user.username.toLowerCase() === handle.toLowerCase() || user.global_name?.toLowerCase() === handle.toLowerCase());
  const id = match?.user.id ?? null;
  memberIds.set(handle, id);
  return id;
}
async function send(channelId, text, users = []) {
  const names = users.map((login) => DISCORD_HANDLES[login] ?? login).filter(Boolean);
  await discord(`/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify({ content: `${names.join(" ")}${names.length ? " " : ""}${text}`, allowed_mentions: { parse: [] } }) });
}
async function addToThread(threadId, users = []) {
  const ids = (await Promise.all(users.map(memberId))).filter(Boolean);
  for (const id of ids) await discord(`/channels/${threadId}/thread-members/${id}`, { method: "PUT", body: "" });
}
async function removeFromThread(threadId, users = []) {
  const ids = (await Promise.all(users.map(memberId))).filter(Boolean);
  for (const id of ids) await discord(`/channels/${threadId}/thread-members/${id}`, { method: "DELETE" });
}
async function setThreadArchived(threadId, archived) {
  await discord(`/channels/${threadId}`, { method: "PATCH", body: JSON.stringify({ archived }) });
}
async function ensureThread(state) {
  if (state.threadId) return state.threadId;
  const issues = state.linkedIssues.length ? `Linked issue${state.linkedIssues.length === 1 ? "" : "s"}: ${state.linkedIssues.map((issue) => `#${issue}`).join(", ")}.` : "[Action needed] No linked issue found.";
  const starter = await discord(`/channels/${config.channelId}/messages`, { method: "POST", body: JSON.stringify({ content: `**PR #${state.number}: ${state.title}**\n${state.url}\n${issues}` }) });
  const thread = await discord(`/channels/${config.channelId}/messages/${starter.id}/threads`, { method: "POST", body: JSON.stringify({ name: `PR #${state.number} - ${state.title}`.slice(0, 100), auto_archive_duration: 10080 }) });
  state.threadId = thread.id;
  await addToThread(thread.id, unique([state.author, ...(state.assignees ?? []), ...(state.reviewers ?? [])]));
  return thread.id;
}
async function notify(state, text, users = []) { if (state.threadId) await send(state.threadId, text, users); }
function isFailure(value) { return ["failure", "timed_out", "cancelled", "action_required", "startup_failure"].includes(value); }
async function maybeReady(state) {
  if (!state.threadId || !state.ciGreen || state.approvers.length < config.approvals || state.readyAt) return;
  await notify(state, "[Ready] Required approvals are present and CI is green. This PR is ready to merge.", [state.author]);
  state.readyAt = now();
}
async function handle(event, payload) {
  const repo = payload.repository?.full_name;
  if (repo !== REPOSITORY) return;
  if (event === "check_suite" && payload.action === "completed") {
    for (const reference of payload.check_suite?.pull_requests ?? []) {
      const state = states[key(repo, reference.number)];
      const sha = payload.check_suite.head_sha;
      if (!state?.threadId || (state.sha && sha && state.sha !== sha)) continue;
      if (isFailure(payload.check_suite.conclusion) && state.lastCiFailureSha !== sha) {
        state.lastCiFailureSha = sha; state.ciGreen = false;
        await notify(state, `[CI failing] Commit ${sha?.slice(0, 7) ?? "unknown"} has a failing check.`, [state.author]);
      } else if (payload.check_suite.conclusion === "success") {
        state.ciGreen = true;
        if (state.lastCiPassSha !== sha) {
          state.lastCiPassSha = sha;
          await notify(state, `[CI passed] All checks passed for commit ${sha?.slice(0, 7) ?? "unknown"}.`);
        }
        await maybeReady(state);
      }
    }
    await saveState(); return;
  }
  const pr = payload.pull_request;
  if (!pr) return;
  const state = prState(pr, repo);
  if (state.open) await ensureThread(state);
  if (!state.threadId) { await saveState(); return; }
  await addToThread(state.threadId, unique([state.author, ...(state.assignees ?? []), ...(state.reviewers ?? [])]));
  if (event === "pull_request") {
    if (payload.action === "assigned" && payload.assignee?.login) {
      state.assignees = unique([...(state.assignees ?? []), payload.assignee.login]);
      await addToThread(state.threadId, [payload.assignee.login]);
    }
    if (payload.action === "unassigned" && payload.assignee?.login) {
      state.assignees = (state.assignees ?? []).filter((login) => login !== payload.assignee.login);
      await removeFromThread(state.threadId, [payload.assignee.login]);
    }
    if (payload.action === "opened" && state.draft) await setThreadArchived(state.threadId, true);
    if (payload.action === "review_requested" && payload.requested_reviewer?.login) {
      const reviewer = payload.requested_reviewer.login;
      state.reviewers = unique([...state.reviewers, reviewer]); state.reviewRequestedAtByReviewer = { ...(state.reviewRequestedAtByReviewer ?? {}), [reviewer]: Date.now() }; state.completedReviewers = (state.completedReviewers ?? []).filter((login) => login !== reviewer); state.reviewerReminderAtByReviewer = (state.reviewerReminderAtByReviewer ?? []).filter((entry) => entry.login !== reviewer);
      await addToThread(state.threadId, [reviewer]);
      await notify(state, `[Review requested] ${reviewer} has been assigned.`, [reviewer]);
    }
    if (payload.action === "review_request_removed" && payload.requested_reviewer?.login) {
      const reviewer = payload.requested_reviewer.login;
      state.reviewers = state.reviewers.filter((login) => login !== reviewer);
      await removeFromThread(state.threadId, [reviewer]);
      await notify(state, `[Reviewer removed] ${reviewer} is no longer assigned to this PR.`);
    }
    if (payload.action === "converted_to_draft") { await setThreadArchived(state.threadId, true); await notify(state, "[Draft] This PR was moved back to draft; the thread is archived."); }
    if (payload.action === "ready_for_review") { await setThreadArchived(state.threadId, false); await addToThread(state.threadId, state.reviewers); await notify(state, "[Ready for review] This PR is no longer a draft.", state.reviewers); }
    if (payload.action === "synchronize") {
      state.approvers = []; state.sha = pr.head?.sha; state.ciGreen = false; state.lastAuthorCommitAt = now(); delete state.readyAt;
    }
    if (pr.mergeable_state === "dirty" && !state.hasConflict) { state.hasConflict = true; await notify(state, "[Merge conflict] This PR now has merge conflicts.", [state.author]); }
    if (pr.mergeable_state && pr.mergeable_state !== "dirty") state.hasConflict = false;
  }
  if (event === "pull_request" && payload.action === "closed") {
    await notify(state, pr.merged ? `[Merged] This PR was merged. Closing the PR thread.` : `[Closed] This PR was closed. Removing the PR thread.`);
    try {
    await discord(`/channels/${state.threadId}`, { method: "DELETE" });
    } catch {
      // If the bot lacks Manage Threads, archive and lock as a safe fallback.
      await discord(`/channels/${state.threadId}`, { method: "PATCH", body: JSON.stringify({ archived: true, locked: true }) });
    }
    delete states[key(repo, pr.number)];
    await saveState(); return;
  }
  if (event === "pull_request_review" && payload.action === "submitted") {
    const reviewer = payload.review?.user?.login; const decision = payload.review?.state?.toLowerCase();
    if (reviewer) { await addToThread(state.threadId, [reviewer]); state.completedReviewers = unique([...(state.completedReviewers ?? []), reviewer]); state.reviewerReminderAtByReviewer = (state.reviewerReminderAtByReviewer ?? []).filter((entry) => entry.login !== reviewer); }
    if (decision === "changes_requested") { state.changesRequestedAt = now(); delete state.changesReminderAt; await notify(state, `[Changes requested] ${reviewer ?? "A reviewer"} requested changes on this PR.`, [state.author]); }
    if (decision === "approved" && reviewer) { state.approvers = unique([...state.approvers, reviewer]); await maybeReady(state); }
  }
  await saveState();
}
function businessDays(from, to) { let days = 0; const cursor = new Date(from); while (cursor < to) { cursor.setDate(cursor.getDate() + 1); if (cursor.getDay() !== 0 && cursor.getDay() !== 6) days++; } return days; }
async function reminders() {
  const current = new Date();
  for (const state of Object.values(states)) {
    if (!state.open || state.draft || !state.threadId) continue;
    if (state.changesRequestedAt && (!state.lastAuthorCommitAt || state.lastAuthorCommitAt < state.changesRequestedAt) && businessDays(state.changesRequestedAt, current) >= 2 && (!state.changesReminderAt || businessDays(state.changesReminderAt, current) >= 2)) { await notify(state, "[Reminder] Requested changes are awaiting an author update.", [state.author]); state.changesReminderAt = now(); }
    const completed = new Set(state.completedReviewers ?? []);
    const remindersSent = state.reviewerReminderAtByReviewer ?? [];
    for (const reviewer of state.reviewers ?? []) {
      if (completed.has(reviewer)) continue;
      const assignedAt = state.reviewRequestedAtByReviewer?.[reviewer];
      const lastReminder = remindersSent.find((entry) => entry.login === reviewer)?.at ?? 0;
      if (assignedAt && Date.now() - assignedAt >= 24 * 60 * 60 * 1000 && (!lastReminder || Date.now() - lastReminder >= 24 * 60 * 60 * 1000)) {
        await notify(state, "[Reminder] Friendly review reminder.", [reviewer]);
        state.reviewerReminderAtByReviewer = [...remindersSent.filter((entry) => entry.login !== reviewer), { login: reviewer, at: Date.now() }];
      }
    }
    if (state.lastActivityAt && businessDays(state.lastActivityAt, current) >= 5 && (!state.idleReminderAt || businessDays(state.idleReminderAt, current) >= 5)) { await notify(state, "[Idle PR] No review progress in five business days. Please update, request review, or close it.", [state.author]); state.idleReminderAt = now(); }
  }
  await saveState();
}
await loadState();
createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/github/pr-webhook") { response.writeHead(404).end(); return; }
  const chunks = []; for await (const chunk of request) chunks.push(chunk); const body = Buffer.concat(chunks).toString("utf8");
  if (!verifySignature(body, request.headers["x-hub-signature-256"])) { response.writeHead(401).end("Invalid signature"); return; }
  try { await handle(request.headers["x-github-event"], JSON.parse(body)); response.writeHead(204).end(); } catch (error) { console.error(error); response.writeHead(500).end("Notifier failed"); }
}).listen(PORT, "127.0.0.1", () => console.log(`PR notifier listening on 127.0.0.1:${PORT}`));
setInterval(() => reminders().catch(console.error), 60 * 60 * 1000).unref();
