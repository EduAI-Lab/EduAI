import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_BRANCH_LENGTH = 200;

export function isSafeBranchInput(branch) {
  if (typeof branch !== "string" || branch.length === 0) return false;
  if (branch.length > MAX_BRANCH_LENGTH || branch.trim() !== branch) return false;
  if (branch.startsWith("-") || branch.includes("..") || branch.includes("@{")) {
    return false;
  }
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch);
}

export function isAuthorized(member, userId, allowedUserIds, allowedRoleIds) {
  if (allowedUserIds.has(userId)) return true;

  const memberRoleIds = Array.isArray(member?.roles)
    ? member.roles
    : member?.roles?.cache
      ? [...member.roles.cache.keys()]
      : [];

  return memberRoleIds.some((roleId) => allowedRoleIds.has(roleId));
}

async function git(repo, args) {
  const { stdout } = await execFileAsync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
  return stdout.trim();
}

export async function getRepoStatus(repo) {
  const [branch, sha, status] = await Promise.all([
    git(repo, ["branch", "--show-current"]),
    git(repo, ["rev-parse", "--short=8", "HEAD"]),
    git(repo, ["status", "--porcelain", "--untracked-files=normal"]),
  ]);

  return {
    branch: branch || "(detached HEAD)",
    sha,
    dirty: status.length > 0,
  };
}

export function summarizeOutput(value, maxLength = 1_500) {
  const normalized = String(value || "").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}\n… output truncated`;
}
