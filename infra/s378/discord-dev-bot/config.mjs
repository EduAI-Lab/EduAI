import path from "node:path";

export function parseIdList(value = "") {
  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig() {
  const repo = process.env.EDUAI_REPO?.trim()
    || "/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore";

  return {
    token: requireEnv("DISCORD_TOKEN"),
    applicationId: requireEnv("DISCORD_APPLICATION_ID"),
    guildId: requireEnv("DISCORD_GUILD_ID"),
    channelId: requireEnv("DISCORD_CHANNEL_ID"),
    allowedUserIds: parseIdList(process.env.DISCORD_ALLOWED_USER_IDS),
    allowedRoleIds: parseIdList(process.env.DISCORD_ALLOWED_ROLE_IDS),
    repo: path.resolve(repo),
    healthUrl: process.env.EDUAI_HEALTH_URL?.trim()
      || "http://127.0.0.1:3000/",
    defaultBranch: process.env.EDUAI_DEFAULT_BRANCH?.trim() || "development",
  };
}
